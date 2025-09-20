export type Attachment =
  | { type: "image"; base64: string; images?: Array<{ base64: string; filename?: string; size?: number; type?: string }> }
  | { type: "link"; url: string; links?: Array<{ url: string; title?: string }> }
  | { type: "file"; base64: string; filename: string; files?: Array<{ base64: string; filename: string; size?: number; type?: string }> }
  | null;

export type InitialMessage = {
  type: "initial";
  text: string;
  attachment: Attachment;
};

export type ReminderMessage = {
  type: "reminder";
  offset_minutes: number;
  text: string;
  attachment: Attachment;
};

export type PromoMessageStep = InitialMessage | ReminderMessage;

export type PromoMessageFlow = [InitialMessage, ...ReminderMessage[]] | [InitialMessage];
