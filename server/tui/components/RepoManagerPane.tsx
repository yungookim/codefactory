import React from "react";
import { Box, Text } from "ink";
import type { InputMode } from "../useSelectionState";
import { color, glyph } from "../theme";

const ACTIONS = ["Sync repositories", "Add repository", "Add PR URL"] as const;

export function RepoManagerPane(props: {
  repos: string[];
  selectedActionIndex: number;
  inputMode: InputMode;
  inputValue: string;
}) {
  return (
    <Box flexDirection="column">
      {ACTIONS.map((action, index) => {
        const selected = index === props.selectedActionIndex;
        return (
          <Box key={action}>
            <Text color={selected ? color.accent : color.muted}>
              {selected ? `${glyph.focus} ` : "  "}
            </Text>
            <Text color={selected ? color.accent : undefined} bold={selected}>
              {action}
            </Text>
          </Box>
        );
      })}
      <Box flexDirection="column" marginTop={1}>
        <Text color={color.muted}>Tracked repositories</Text>
        {props.repos.length === 0 ? (
          <Text color={color.muted}>  None yet.</Text>
        ) : (
          props.repos.map((repo) => (
            <Box key={repo}>
              <Text color={color.muted}>  {glyph.dot} </Text>
              <Text>{repo}</Text>
            </Box>
          ))
        )}
      </Box>
      {props.inputMode !== "none" && (
        <Box marginTop={1}>
          <Text color={color.ok} bold>
            {props.inputMode === "addRepo" ? "Repo" : "PR URL"}
          </Text>
          <Text color={color.muted}>{": "}</Text>
          <Text>{props.inputValue || "…"}</Text>
          <Text color={color.accent}>▌</Text>
        </Box>
      )}
    </Box>
  );
}
