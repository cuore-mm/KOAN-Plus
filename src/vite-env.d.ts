/// <reference types="vite/client" />

declare const chrome: {
  runtime: {
    sendMessage(message: unknown): Promise<unknown>;
  };
};
