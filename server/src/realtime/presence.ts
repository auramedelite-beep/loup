const socketsByUser = new Map<string, Set<string>>();

export function registerSocket(userId: string, socketId: string): number {
  let set = socketsByUser.get(userId);
  if (!set) {
    set = new Set();
    socketsByUser.set(userId, set);
  }
  set.add(socketId);
  return set.size;
}

export function unregisterSocket(userId: string, socketId: string): number {
  const set = socketsByUser.get(userId);
  if (!set) return 0;
  set.delete(socketId);
  if (set.size === 0) socketsByUser.delete(userId);
  return set.size;
}

export function isOnline(userId: string): boolean {
  return (socketsByUser.get(userId)?.size ?? 0) > 0;
}

export function onlineCount(): number {
  return socketsByUser.size;
}

export function onlineUserIds(): string[] {
  return [...socketsByUser.keys()];
}

export function disconnectAll(): void {
  socketsByUser.clear();
}
