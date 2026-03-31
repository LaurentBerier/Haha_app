export type ChatError =
  | {
      code: 'messageTooLong';
      maxLength: number;
    }
  | {
      code: 'imageNotSupportedInImpro';
    }
  | {
      code: 'imageNotSupportedInGames';
    }
  | {
      code: 'invalidConversation';
    };
