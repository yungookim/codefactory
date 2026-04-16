import React from "react";
import { Box, Text } from "ink";
import type { Config } from "@shared/schema";
import { color, glyph } from "../theme";

type SettingRow = { label: string; value: boolean | string };

export function SettingsPane(props: {
  config: Config | null;
  selectedIndex: number;
}) {
  const rows: SettingRow[] = [
    { label: "Coding agent", value: props.config?.codingAgent ?? "claude" },
    { label: "Auto-resolve conflicts", value: Boolean(props.config?.autoResolveMergeConflicts) },
    { label: "Auto-update docs", value: Boolean(props.config?.autoUpdateDocs) },
  ];

  return (
    <Box flexDirection="column">
      {rows.map((row, index) => {
        const selected = index === props.selectedIndex;
        const isToggle = typeof row.value === "boolean";
        const toneForValue = isToggle
          ? row.value ? color.ok : color.muted
          : color.accent;

        return (
          <Box key={row.label}>
            <Text color={selected ? color.accent : color.muted}>
              {selected ? `${glyph.focus} ` : "  "}
            </Text>
            <Text color={selected ? color.accent : undefined}>{row.label}</Text>
            <Text color={color.muted}>{"  "}</Text>
            {isToggle ? (
              <Text color={toneForValue} bold>
                {row.value ? `${glyph.dot} on` : `${glyph.ring} off`}
              </Text>
            ) : (
              <Text color={toneForValue} bold>
                {String(row.value)}
              </Text>
            )}
          </Box>
        );
      })}
      <Box marginTop={1}>
        <Text color={color.muted}>Enter toggles the selected setting.</Text>
      </Box>
    </Box>
  );
}
