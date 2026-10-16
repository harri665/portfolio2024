import { sendReport, visitId } from '../../../utils/visit';

function deviceInfo() {
  const dpr = window.devicePixelRatio || 1;
  return {
    cores: navigator.hardwareConcurrency,
    memory: navigator.deviceMemory,
    screen: `${window.screen.width}x${window.screen.height}@${Math.round(dpr * 100) / 100}`,
  };
}

export function reportRelight(report, visit = visitId()) {
  sendReport('relight', { ...deviceInfo(), ...report }, visit);
}
