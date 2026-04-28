export type ActivityPayloadDescription = {
  label: string;
  detail: string | null;
  targetUrl: string | null;
};

export function buildActivityPayload(description: ActivityPayloadDescription): Record<string, unknown> {
  return {
    activityLabel: description.label,
    activityDetail: description.detail,
    activityTargetUrl: description.targetUrl,
  };
}

export function readActivityPayload(payload: Record<string, unknown>): ActivityPayloadDescription | null {
  const label = payload.activityLabel;
  if (typeof label !== "string" || !label.trim()) {
    return null;
  }

  const detail = payload.activityDetail;
  const targetUrl = payload.activityTargetUrl;

  return {
    label,
    detail: typeof detail === "string" ? detail : null,
    targetUrl: typeof targetUrl === "string" ? targetUrl : null,
  };
}
