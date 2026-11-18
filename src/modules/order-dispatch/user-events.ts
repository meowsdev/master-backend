/**
 * What order dispatch needs from the realtime layer: send an event to one user's open apps. It is an
 * interface (not the chat gateway class) so dispatch stays easy to test and independent of sockets.
 */
export interface UserEventPublisher {
  publishToUser(userId: string, event: string, payload: unknown): void;
}

export const USER_EVENT_PUBLISHER = Symbol('USER_EVENT_PUBLISHER');
