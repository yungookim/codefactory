import React from "react";
import { Box, Text } from "ink";
import { color } from "../theme";

const TONE_FOR_ACTION: Record<string, string> = {
  Accept: color.ok,
  Reject: color.err,
  Flag: color.warn,
  Retry: color.info,
  Collapse: color.muted,
};

export function FeedbackActions(props: {
  actions: string[];
  selectedActionIndex: number;
}) {
  return (
    <Box marginTop={1}>
      {props.actions.map((action, index) => {
        const tone = TONE_FOR_ACTION[action] ?? color.accent;
        const isSelected = index === props.selectedActionIndex;

        return (
          <React.Fragment key={action}>
            {isSelected ? (
              <Text inverse bold color={tone}>
                {` ${action} `}
              </Text>
            ) : (
              <Text color={tone}>{` ${action} `}</Text>
            )}
            {index < props.actions.length - 1 && <Text> </Text>}
          </React.Fragment>
        );
      })}
    </Box>
  );
}
