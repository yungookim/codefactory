import React from "react";
import { Box, Text } from "ink";
import type { PR } from "@shared/schema";
import { FeedbackList } from "./FeedbackList";
import { formatStatusLabel } from "../viewModel";
import { color, glyph, prStatusGlyph, prStatusTone } from "../theme";

type PrDetailPaneProps = {
  pr: PR | null;
  selectedFeedbackIndex: number;
  active: boolean;
  expandedFeedbackIds: Set<string>;
  selectedActionIndex: number;
  selectedActions: string[];
  width?: number;
};

export function PrDetailPane(props: PrDetailPaneProps) {
  const borderColor = props.active ? color.accent : color.muted;

  return (
    <Box
      flexDirection="column"
      borderStyle={props.active ? "round" : "single"}
      borderColor={borderColor}
      paddingX={1}
      width={props.width}
      flexGrow={1}
    >
      <Box marginBottom={1}>
        <Text bold color={props.active ? color.accent : undefined}>
          PR Detail
        </Text>
      </Box>
      {!props.pr ? (
        <Text color={color.muted}>Select a PR.</Text>
      ) : (
        <>
          <Box>
            <Text color={color.muted}>{props.pr.repo}</Text>
            <Text color={color.muted}>{"  "}</Text>
            <Text bold color={color.accent}>#{props.pr.number}</Text>
          </Box>
          <Box>
            <Text bold>{props.pr.title}</Text>
          </Box>
          <Box marginTop={1}>
            <Text color={prStatusTone(props.pr.status)}>
              {prStatusGlyph(props.pr.status)}
              {" "}
              {formatStatusLabel(props.pr.status)}
            </Text>
            <Text color={color.muted}>{`  ${glyph.sep}  `}</Text>
            <Text color={props.pr.watchEnabled ? color.ok : color.warn}>
              {props.pr.watchEnabled ? glyph.dot : glyph.pause}
              {" "}
              {props.pr.watchEnabled ? "watching" : "paused"}
            </Text>
            <Text color={color.muted}>{`  ${glyph.sep}  `}</Text>
            <Text color={color.muted}>feedback </Text>
            <Text bold>{props.pr.feedbackItems.length}</Text>
          </Box>
          <Box marginTop={1}>
            <FeedbackList
              items={props.pr.feedbackItems}
              selectedFeedbackIndex={props.selectedFeedbackIndex}
              active={props.active}
              expandedFeedbackIds={props.expandedFeedbackIds}
              selectedActionIndex={props.selectedActionIndex}
              selectedActions={props.selectedActions}
              width={props.width ?? 80}
            />
          </Box>
        </>
      )}
    </Box>
  );
}
