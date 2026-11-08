import ngrok from "@ngrok/ngrok";
import { log } from "./log.js";

/**
 * A public tunnel that exposes a local port to Twilio.
 *
 * Twilio Media Streams connects to a `wss://` URL, which must be reachable from
 * the public internet. ngrok forwards that public URL back to our local
 * HTTP/WebSocket server. The free ngrok tier is sufficient for development.
 */

export interface Tunnel {
  /** Public HTTPS URL, e.g. `https://abc123.ngrok.app`. */
  url: string;
  /** The `wss://` URL Twilio should dial for the media stream. */
  wsUrl: string;
  close(): Promise<void>;
}

export async function startTunnel(port: number, authtoken?: string): Promise<Tunnel> {
  log.info(`Opening public tunnel to localhost:${port} ...`);
  const listener = await ngrok.forward({ addr: port, authtoken });
  const url = listener.url();
  if (!url) {
    throw new Error("ngrok did not return a public URL");
  }
  const wsUrl = url.replace(/^https:/, "wss:") + "/media";
  log.info(`Public URL: ${url}`);
  return {
    url,
    wsUrl,
    close: async () => {
      await ngrok.disconnect(url);
      log.info("Tunnel closed");
    },
  };
}
