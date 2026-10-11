/** Composer-only slash commands. The syntax is stripped before the body is sealed or queued. */

export type MessageCommandName = "silent" | "magic" | "vanish";

export type MessageCommand = {
  readonly name: MessageCommandName;
  readonly text: string;
  readonly meta: Readonly<Record<string, boolean>>;
};

export const MESSAGE_COMMANDS: readonly {
  readonly name: MessageCommandName;
  readonly label: string;
  readonly hint: string;
}[] = [
  { name: "silent", label: "Silent", hint: "No notification or sound" },
  { name: "magic", label: "Magic", hint: "Animate the message text on both sides" },
  { name: "vanish", label: "Vanish", hint: "Disappears one minute after first read" },
];

const META_BY_COMMAND: Record<MessageCommandName, Readonly<Record<string, boolean>>> = {
  silent: { silent: true },
  magic: { magic: true },
  vanish: { vanish: true },
};

/** Only a leading, exact supported command is special; all other slash text is ordinary text. */
export function parseMessageCommand(value: string): MessageCommand | null {
  const match = /^\/(silent|magic|vanish)(?:[\t ]+([\s\S]*))?$/i.exec(value.trim());
  if (!match) return null;
  const name = match[1]!.toLowerCase() as MessageCommandName;
  return {
    name,
    text: (match[2] ?? "").trim(),
    meta: META_BY_COMMAND[name],
  };
}

/** Show matching commands only while the whole draft is still a slash prefix. */
export function commandSuggestions(value: string) {
  if (!value.startsWith("/") || /\s/.test(value)) return [];
  const query = value.slice(1).toLowerCase();
  return MESSAGE_COMMANDS.filter((command) => command.name.startsWith(query));
}

/** Insert a selected command and leave the composer ready for its body. */
export function commandDraft(name: MessageCommandName): string {
  return `/${name} `;
}
