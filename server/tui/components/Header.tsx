import React from "react";
import { Box, Text } from "ink";
import type { Config } from "@shared/schema";
import type { TuiRuntimeSnapshot } from "../types";
import { color, glyph } from "../theme";

type HeaderProps = {
  runtime: TuiRuntimeSnapshot | null;
  config: Config | null;
  repoCount: number;
  prCount: number;
  activePane: string;
  contextMode: string;
};

function Sep() {
  return <Text color={color.muted}>{` ${glyph.sep} `}</Text>;
}

function Chip(props: { glyph: string; label: string; value: number | string; tone: string }) {
  return (
    <Text>
      <Text color={props.tone}>{props.glyph}</Text>
      <Text> </Text>
      <Text bold color={props.tone}>
        {props.value}
      </Text>
      <Text color={color.muted}>{" "}{props.label}</Text>
    </Text>
  );
}

export function Header(props: HeaderProps) {
  const agent = props.config?.codingAgent ?? "claude";
  const active = props.runtime?.activeRuns ?? 0;

  return (
    <Box justifyContent="space-between" borderStyle="round" borderColor={color.accent} paddingX={1}>
      <Box>
        <Text color={color.accent} bold>{glyph.focus} </Text>
        <Text bold>oh-my-pr</Text>
        <Text color={color.muted}>{` ${glyph.sep} `}</Text>
        <Text color={color.muted}>agent </Text>
        <Text color={color.accent}>{agent}</Text>
      </Box>
      <Box>
        <Chip glyph={glyph.dot} label="repos" value={props.repoCount} tone={color.accent} />
        <Sep />
        <Chip glyph={glyph.dot} label="prs" value={props.prCount} tone={color.accent} />
        <Sep />
        <Chip
          glyph={active > 0 ? glyph.running : glyph.ring}
          label="active"
          value={active}
          tone={active > 0 ? color.info : color.muted}
        />
      </Box>
    </Box>
  );
}
