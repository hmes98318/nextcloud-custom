// TLS handshakes against the HTTPS port of the test environment.

import { connect } from 'node:tls';
import type { ConnectionOptions, PeerCertificate } from 'node:tls';

/** What a TLS connection negotiated, or why it failed. */
export interface TlsProbe {
  protocol: string | null;
  cipher: string;
  alpn: string | false | null;
  certificate: PeerCertificate | undefined;
  error: string | undefined;
}

export interface TlsProbeOptions {
  port: number;
  /** Application protocols to offer, such as `h2`. */
  alpn?: string[];
  /** The highest protocol version to offer. */
  maxVersion?: 'TLSv1.2' | 'TLSv1.3';
}

/** Opens a TLS connection and reports what was negotiated. */
export function probeTls(options: TlsProbeOptions): Promise<TlsProbe> {
  return new Promise(resolve => {
    const settings: ConnectionOptions = {
      host: '127.0.0.1',
      port: options.port,
      servername: 'localhost',
      rejectUnauthorized: false,
      maxVersion: options.maxVersion,
    };

    // The option name is fixed by Node.js and is not camel case.
    settings.ALPNProtocols = options.alpn;

    const socket = connect(settings);

    socket.setTimeout(15_000, () => {
      socket.destroy(new Error('TLS handshake timed out'));
    });
    socket.on('secureConnect', () => {
      const probe: TlsProbe = {
        protocol: socket.getProtocol(),
        cipher: socket.getCipher().name,
        alpn: socket.alpnProtocol,
        certificate: socket.getPeerCertificate(),
        error: undefined,
      };

      socket.end();
      resolve(probe);
    });
    socket.on('error', (error: Error) => {
      resolve({
        protocol: null,
        cipher: '',
        alpn: null,
        certificate: undefined,
        error: error.message,
      });
    });
  });
}
