import { useSyncExternalStore } from 'react';
import { getMotion, subscribeMotion } from '../utils/motion';

/**
 * The motion level in effect ('full' | 'calm' | 'off'), re-rendering when it changes.
 * Charts use it to switch their own animations off below Full.
 */
export const useMotion = () => useSyncExternalStore(subscribeMotion, getMotion, getMotion);
