export type ReminderMetadataItem = {
    message: string;
    remindAt: string;
    attachment_sent?: Record<string, any> | Record<string, any>[];
    error?: string;
};

export type ReminderMetadata = ReminderMetadataItem[];
