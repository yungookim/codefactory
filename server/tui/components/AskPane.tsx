import React from "react";
import { Box, Text } from "ink";
import type { PRQuestion } from "@shared/schema";
import { wrapText } from "../viewModel";
import { color, glyph } from "../theme";

export function AskPane(props: {
  questions: PRQuestion[];
  inputMode: boolean;
  inputValue: string;
  width: number;
}) {
  return (
    <Box flexDirection="column">
      {props.questions.length === 0 ? (
        <Text color={color.muted}>Press Enter to ask about the selected PR.</Text>
      ) : (
        props.questions.slice(-6).map((question) => (
          <Box key={question.id} flexDirection="column" marginBottom={1}>
            <Box>
              <Text color={color.accent} bold>Q </Text>
              <Text>{question.question}</Text>
            </Box>
            {question.status === "answered" && question.answer ? (
              wrapText(question.answer, Math.max(20, props.width - 4)).map((line, index) => (
                <Box key={`${question.id}-${index}`}>
                  {index === 0 && <Text color={color.ok} bold>A </Text>}
                  {index !== 0 && <Text>  </Text>}
                  <Text>{line}</Text>
                </Box>
              ))
            ) : question.status === "error" ? (
              <Box>
                <Text color={color.err} bold>{glyph.cross} </Text>
                <Text color={color.err}>{question.error ?? "Unknown error"}</Text>
              </Box>
            ) : (
              <Box>
                <Text color={color.info}>{glyph.running} </Text>
                <Text color={color.muted}>Agent is thinking…</Text>
              </Box>
            )}
          </Box>
        ))
      )}
      <Box marginTop={1}>
        {props.inputMode ? (
          <>
            <Text color={color.ok} bold>Ask</Text>
            <Text color={color.muted}>{": "}</Text>
            <Text>{props.inputValue || "…"}</Text>
            <Text color={color.accent}>▌</Text>
          </>
        ) : (
          <Text color={color.muted}>Press Enter to compose a question</Text>
        )}
      </Box>
    </Box>
  );
}
