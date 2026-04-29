import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import * as cloudSync from '@/services/cloudSync';
import * as settings from '@/services/settings';

export function useCloudSync(): void {
  const inFlight = useRef(false);

  useEffect(() => {
    const trigger = async () => {
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        const enabled = await settings.getCloudSyncEnabled();
        if (!enabled) return;
        if (!(await cloudSync.isAvailable())) return;
        await cloudSync.uploadManifestIfChanged();
        const freq = await settings.getCloudSnapshotFrequency();
        const retention = await settings.getCloudSnapshotRetention();
        await cloudSync.maybeSnapshot(freq, retention);
      } catch {
        // best-effort, nu blocăm UI
      } finally {
        inFlight.current = false;
      }
    };

    void trigger();

    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active' || next === 'background') {
        void trigger();
      }
    });
    return () => sub.remove();
  }, []);
}
