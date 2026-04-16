import React from "react";
import { Box, Text } from "ink";
import { getFooterHints } from "../viewModel";
import type { ContextMode } from "../useSelectionState";
import { color, glyph } from "../theme";

type FooterProps = {
  contextMode: ContextMode;
  statusMessage: string | null;
  errorMessage: string | null;
};

export function Footer(props: FooterProps) {
  const hasError = Boolean(props.errorMessage);
  const statusTone = hasError ? color.err : props.statusMessage ? color.ok : color.muted;
  const statusText = props.errorMessage ?? props.statusMessage ?? "Ready";
  const hints = getFooterHints();

  return (
    <Box
      justifyContent="space-between"
      borderStyle="round"
      borderColor={color.muted}
      paddingX={1}
    >
      <Box>
        <Text color={statusTone}>{glyph.dot}</Text>
        <Text> </Text>
        <Text color={statusTone} bold={hasError}>
          {statusText}
        </Text>
      </Box>
      <Box>
        {hints.map((hint, index) => (
          <React.Fragment key={hint.key}>
            <Text color={color.accent} inverse bold>{` ${hint.key} `}</Text>
            <Text color={color.muted}>{` ${hint.label}`}</Text>
            {index < hints.length - 1 && <Text color={color.muted}>{"  "}</Text>}
          </React.Fragment>
        ))}
      </Box>
    </Box>
  );
}
