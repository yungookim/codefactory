import React from "react";
import { Box, Text } from "ink";
import type { PR } from "@shared/schema";
import { color, glyph, prStatusGlyph, prStatusTone } from "../theme";
import { countActiveFeedbackStatuses, isPRReadyToMerge } from "../viewModel";

type PrListPaneProps = {
  prs: PR[];
  selectedPrIndex: number;
  active: boolean;
  width?: number;
};

function truncate(input: string, max: number): string {
  if (max <= 1) return input.slice(0, max);
  if (input.length <= max) return input;
  return `${input.slice(0, Math.max(1, max - 1))}…`;
}

function padNumber(n: number, width: number): string {
  const str = `#${n}`;
  return str.length >= width ? str : `${" ".repeat(width - str.length)}${str}`;
}

type Badge = { label: string; tone: string };

function getBadges(pr: PR): Badge[] {
  const badges: Badge[] = [];
  const counts = countActiveFeedbackStatuses(pr.feedbackItems);

  if (counts.failed > 0) badges.push({ label: `${counts.failed}!`, tone: color.err });
  if (counts.warning > 0) badges.push({ label: `${counts.warning}⚠`, tone: color.warn });
  if (counts.inProgress > 0) badges.push({ label: `${counts.inProgress}◐`, tone: color.info });
  if (counts.queued > 0) badges.push({ label: `${counts.queued}○`, tone: color.accent });
  if (!pr.watchEnabled) badges.push({ label: "paused", tone: color.muted });
  if (isPRReadyToMerge(pr.feedbackItems) && pr.status !== "processing") {
    badges.push({ label: "ready", tone: color.ok });
  }
  return badges;
}

function PrRow(props: { pr: PR; selected: boolean; width: number }) {
  const { pr, selected, width } = props;
  const tone = prStatusTone(pr.status);
  const badges = getBadges(pr);
  const numCol = padNumber(pr.number, 5);
  const badgesText = badges.map((b) => b.label).join(" ");
  const reserved = 2 + 1 + numCol.length + 1 + badgesText.length + 1 + 2;
  const titleSpace = Math.max(8, width - reserved);
  const title = truncate(pr.title, titleSpace);

  return (
    <Box>
      <Text color={selected ? color.accent : color.muted}>
        {selected ? `${glyph.focus} ` : "  "}
      </Text>
      <Text color={tone}>{prStatusGlyph(pr.status)}</Text>
      <Text color={color.muted}>{` ${numCol} `}</Text>
      <Text bold={selected} color={selected ? color.accent : undefined}>
        {title}
      </Text>
      {badges.length > 0 && (
        <>
          <Text>{" "}</Text>
          {badges.map((b, i) => (
            <Text key={i} color={b.tone}>
              {b.label}
              {i < badges.length - 1 ? " " : ""}
            </Text>
          ))}
        </>
      )}
    </Box>
  );
}

export function PrListPane(props: PrListPaneProps) {
  const borderColor = props.active ? color.accent : color.muted;
  const innerWidth = (props.width ?? 40) - 4;

  return (
    <Box
      flexDirection="column"
      borderStyle={props.active ? "round" : "single"}
      borderColor={borderColor}
      paddingX={1}
      width={props.width}
    >
      <Box marginBottom={1}>
        <Text bold color={props.active ? color.accent : undefined}>
          Pull Requests
        </Text>
        <Text color={color.muted}>{`  ${props.prs.length}`}</Text>
      </Box>
      {props.prs.length === 0 ? (
        <Text color={color.muted}>No tracked PRs.</Text>
      ) : (
        props.prs.map((pr, index) => (
          <PrRow
            key={pr.id}
            pr={pr}
            selected={index === props.selectedPrIndex}
            width={innerWidth}
          />
        ))
      )}
    </Box>
  );
}
