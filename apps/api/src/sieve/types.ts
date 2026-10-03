/** Shape of the request sent to `POST /api/auth/device/code`. */
export interface SieveDeviceLoginPayload {
  client_name: string;
}

/** Shape of the response returned by `POST /api/auth/device/code`. */
export interface SieveDeviceLoginResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval?: number;
}

/** Status values the device login can be in. */
export type SieveDeviceLoginStatus =
  | 'verified'
  | 'expired_token'
  | 'access_denied'
  | 'authorization_pending'
  | 'slow_down'
  | 'error';

/** Shape of the response returned by `POST /api/auth/device/token`. */
export interface SieveDeviceTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

/** Shape of the response returned by `POST /api/scrapes`. */
export interface SieveScrapeRunResponse {
  run_id: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  message: string;
  started_at?: string;
  completed_at?: string;
  error?: string;
}

/** Shape of the scrape-run payload accepted by `POST /api/scrapes`. */
export interface SieveScrapeRun {
  instruction: string;
  target_urls: string[];
  fields: string[];
  schema: string;
  output_schema: string;
  table_shape: string;
  compliance_mode: 'regular' | 'yolo';
}

/** Session that survives the whole scrape lifecycle. */
export interface SieveScrapeSession {
  run_id: string;
  user_code: string;
  verification_uri: string;
  status: SieveDeviceLoginStatus;
  started_at?: string;
  completed_at?: string;
}

/** Single turn (message) in a scrape run — returned by `/messages`. */
export interface SieveFollowupTurn {
  turn_id: string;
  run_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}
