import type { BackgroundJob } from "@shared/schema";
import type { CodingAgent } from "./agentRunner";
import type { PRBabysitter } from "./babysitter";
import { CancelBackgroundJobError, type BackgroundJobHandlers } from "./backgroundJobDispatcher";
import { answerPRQuestion } from "./prQuestionAgent";
import type { ReleaseManager } from "./releaseManager";
import { generateSocialChangelog } from "./socialChangelogAgent";
import type { IStorage } from "./storage";

function readStringPayload(job: BackgroundJob, key: string): string | null {
  const value = job.payload[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readCodingAgentPayload(job: BackgroundJob, key: string): CodingAgent | null {
  const value = readStringPayload(job, key);
  if (value === "codex" || value === "claude") {
    return value;
  }

  return null;
}

export function createBackgroundJobHandlers(params: {
  storage: IStorage;
  babysitter?: Pick<PRBabysitter, "runQueuedBabysitPR" | "syncAndBabysitTrackedRepos">;
  releaseManager?: Pick<ReleaseManager, "processReleaseRun">;
  questionAnswerer?: typeof answerPRQuestion;
  socialChangelogGenerator?: typeof generateSocialChangelog;
}): BackgroundJobHandlers {
  const storage = params.storage;
  const babysitter = params.babysitter;
  const releaseManager = params.releaseManager;
  const questionAnswerer = params.questionAnswerer ?? answerPRQuestion;
  const socialChangelogGenerator = params.socialChangelogGenerator ?? generateSocialChangelog;

  return {
    sync_watched_repos: babysitter
      ? async () => {
        await babysitter.syncAndBabysitTrackedRepos();
      }
      : undefined,

    babysit_pr: babysitter
      ? async (job) => {
        const pr = await storage.getPR(job.targetId);
        if (!pr) {
          throw new CancelBackgroundJobError(`PR ${job.targetId} no longer exists`);
        }

        const preferredAgent = readCodingAgentPayload(job, "preferredAgent")
          ?? (await storage.getConfig()).codingAgent;
        await babysitter.runQueuedBabysitPR(pr.id, preferredAgent);
      }
      : undefined,

    answer_pr_question: async (job) => {
      const prId = readStringPayload(job, "prId");
      if (!prId) {
        throw new CancelBackgroundJobError(`Background job ${job.id} is missing question PR context`);
      }

      const question = (await storage.getQuestions(prId)).find((entry) => entry.id === job.targetId);
      if (!question) {
        throw new CancelBackgroundJobError(`PR question ${job.targetId} no longer exists`);
      }

      if (question.status === "answered" || question.status === "error") {
        return;
      }

      const config = await storage.getConfig();
      await questionAnswerer({
        storage,
        prId: question.prId,
        questionId: question.id,
        question: question.question,
        preferredAgent: config.codingAgent,
      });
    },

    generate_social_changelog: async (job) => {
      const changelog = await storage.getSocialChangelog(job.targetId);
      if (!changelog) {
        throw new CancelBackgroundJobError(`Social changelog ${job.targetId} no longer exists`);
      }

      if (changelog.status === "done" || changelog.status === "error") {
        return;
      }

      const config = await storage.getConfig();
      await socialChangelogGenerator({
        storage,
        changelogId: changelog.id,
        prSummaries: changelog.prSummaries,
        date: changelog.date,
        preferredAgent: config.codingAgent,
      });
    },

    process_release_run: releaseManager
      ? async (job) => {
        const releaseRun = await storage.getReleaseRun(job.targetId);
        if (!releaseRun) {
          throw new CancelBackgroundJobError(`Release run ${job.targetId} no longer exists`);
        }

        if (releaseRun.status === "published" || releaseRun.status === "skipped") {
          return;
        }

        await releaseManager.processReleaseRun(releaseRun.id);
      }
      : undefined,
  };
}
