export type ChatError =
  | {
      code: 'messageTooLong';
      maxLength: number;
    }
  | {
      code: 'invalidConversation';
    };
