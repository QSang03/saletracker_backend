export type Attachment =
  | { type: "image"; base64: string }
  | { type: "link"; url: string }
  | { type: "file"; base64: string; filename: string }
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
