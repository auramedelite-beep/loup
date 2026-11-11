declare global {
  namespace Express {
    interface Request {
      auth?: {
        id: string;
        username: string;
        role: 'player' | 'admin';
        isGuest: boolean;
        tokenVersion: number;
      };
    }
  }
}

export {};
