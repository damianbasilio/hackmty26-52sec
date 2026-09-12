import { requireOptionalNativeModule, type NativeModule } from 'expo';

export type NearbyStatus =
  | 'stopped'
  | 'advertising'
  | 'browsing'
  | 'connecting'
  | 'connected'
  | 'denied'
  | 'error';

export type NearbyStatusEvent = { status: NearbyStatus; message?: string };
export type NearbyPeerEvent = { peerId: string; displayName: string };
export type NearbyPayloadEvent = NearbyPeerEvent & { json: string };
type Subscription = { remove: () => void };

type NearbyEvents = {
  onStatus: (event: NearbyStatusEvent) => void;
  onPeerJoined: (event: NearbyPeerEvent) => void;
  onPeerLeft: (event: NearbyPeerEvent) => void;
  onPayload: (event: NearbyPayloadEvent) => void;
};

declare class ExpoNearbySplitNativeModule extends NativeModule<NearbyEvents> {
  isSupported(): boolean;
  startHost(displayName: string, roomCode: string, initialPayload: string): Promise<void>;
  joinNearby(displayName: string, roomCode: string): Promise<void>;
  broadcast(payload: string): Promise<void>;
  stop(): Promise<void>;
}

const nativeModule = requireOptionalNativeModule<ExpoNearbySplitNativeModule>('ExpoNearbySplit');

export const nearbySplit = {
  isAvailable: Boolean(nativeModule?.isSupported()),
  startHost: (displayName: string, roomCode: string, payload: string) =>
    nativeModule?.startHost(displayName, roomCode, payload) ?? Promise.resolve(),
  joinNearby: (displayName: string, roomCode: string) =>
    nativeModule?.joinNearby(displayName, roomCode) ?? Promise.resolve(),
  broadcast: (payload: string) => nativeModule?.broadcast(payload) ?? Promise.resolve(),
  stop: () => nativeModule?.stop() ?? Promise.resolve(),
  addStatusListener: (listener: NearbyEvents['onStatus']): Subscription | null =>
    nativeModule?.addListener('onStatus', listener) ?? null,
  addPeerJoinedListener: (listener: NearbyEvents['onPeerJoined']): Subscription | null =>
    nativeModule?.addListener('onPeerJoined', listener) ?? null,
  addPeerLeftListener: (listener: NearbyEvents['onPeerLeft']): Subscription | null =>
    nativeModule?.addListener('onPeerLeft', listener) ?? null,
  addPayloadListener: (listener: NearbyEvents['onPayload']): Subscription | null =>
    nativeModule?.addListener('onPayload', listener) ?? null,
};
