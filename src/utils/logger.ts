export const logger = {
  info(message: string, meta?: unknown): void {
    if (meta === undefined) {
      console.info(message);
      return;
    }

    console.info(message, meta);
  },

  warn(message: string, meta?: unknown): void {
    if (meta === undefined) {
      console.warn(message);
      return;
    }

    console.warn(message, meta);
  },

  error(message: string, error?: unknown): void {
    if (error === undefined) {
      console.error(message);
      return;
    }

    console.error(message, error);
  },
};
