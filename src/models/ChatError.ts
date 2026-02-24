export type ChatError =
  | {
      code: 'messageTooLong';
      maxLength: number;
    };
