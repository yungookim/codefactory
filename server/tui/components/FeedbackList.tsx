import React from "react";
import { Box, Text } from "ink";
import type { FeedbackItem } from "@shared/schema";
import { getFeedbackActions, formatFeedbackStatusLabel, wrapText } from "../viewModel";
import { FeedbackActions } from "./FeedbackActions";
import { color, feedbackGlyph, feedbackTone, glyph } from "../theme";

type FeedbackListProps = {
  items: FeedbackItem[];
  selectedFeedbackIndex: number;
  active: boolean;
  expandedFeedbackIds: Set<string>;
  selectedActionIndex: number;
  selectedActions: string[];
  width: number;
};

export function FeedbackList(props: FeedbackListProps) {
  if (props.items.length === 0) {
    return <Text color={color.muted}>No feedback items yet.</Text>;
  }

  return (
    <Box flexDirection="column">
      {props.items.map((item, index) => {
        const selected = index === props.selectedFeedbackIndex;
        const expanded = props.expandedFeedbackIds.has(item.id);
        const actions = selected && expanded ? props.selectedActions : getFeedbackActions(item);
        const wrappedBody = wrapText(item.body, Math.max(20, props.width - 10));
        const tone = feedbackTone(item.status);
        const statusLabel = formatFeedbackStatusLabel(item.status);
        const location = item.file ? `${item.file}${item.line ? `:${item.line}` : ""}` : "";

        return (
          <Box key={item.id} flexDirection="column" marginBottom={1}>
            <Box>
              <Text color={selected ? color.accent : color.muted}>
                {selected ? `${glyph.focus} ` : "  "}
              </Text>
              <Text color={tone}>{feedbackGlyph(item.status)}</Text>
              <Text color={tone}>{` ${statusLabel}`}</Text>
              <Text color={color.muted}>{`  ${item.author}`}</Text>
              {location && (
                <>
                  <Text color={color.muted}>{`  ${glyph.sep}  `}</Text>
                  <Text color={color.muted}>{location}</Text>
                </>
              )}
            </Box>
            {expanded && (
              <Box flexDirection="column" marginLeft={4} marginTop={0}>
                {wrappedBody.map((line, lineIndex) => (
                  <Text key={`${item.id}-${lineIndex}`} color={color.muted}>
                    {line}
                  </Text>
                ))}
                {selected && props.active && (
                  <FeedbackActions
                    actions={actions}
                    selectedActionIndex={Math.min(props.selectedActionIndex, actions.length - 1)}
                  />
                )}
              </Box>
            )}
          </Box>
        );
      })}
    </Box>
  );
}
