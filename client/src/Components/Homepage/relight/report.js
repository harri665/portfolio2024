import { sendReport, visitId } from '../../../utils/visit';

function device() {
  const dpr = window.devicePixelRatio || 1;
  return {
    cores: navigator.hardwareConcurrency,
    memory: navigator.deviceMemory,
    screen: `${window.screen.width}x${window.screen.height}@${Math.round(dpr * 100) / 100}`,
  };
}

// visit is passed in since it might report after the next page view started
export function reportRelight(report, visit = visitId()) {
  sendReport('relight', { ...device(), ...report }, visit);
}
