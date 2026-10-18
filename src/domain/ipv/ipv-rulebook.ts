import { loadRulebook } from '../shared/rulebook-loader';

export interface IpvRulebook {
  version: string;
  minLivenessScore: number;
  minFaceMatchConfidence: number;
  exemptWhenKraIpvFlag: boolean;
  maxSelfieAttempts: number;
}
export const IPV_RULEBOOK = Symbol('IPV_RULEBOOK');
export const loadIpvRulebook = (file?: string): IpvRulebook =>
  loadRulebook<IpvRulebook>(
    'ipv.v1.json',
    ['version', 'minLivenessScore', 'minFaceMatchConfidence'],
    file,
  );
