import nodemailer from 'nodemailer';

export type Mail = { to: string; subject: string; text: string; html?: string };

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

/** Development: prints the message (and sign-in codes) to the server log. */
export class ConsoleMailer implements Mailer {
  constructor(private readonly log: (msg: string) => void = console.log) {}
  async send(mail: Mail): Promise<void> {
    this.log(`\n--- email to ${mail.to} ---\n${mail.subject}\n\n${mail.text}\n---------------------------\n`);
  }
}

/** Tests: keeps every message in memory. */
export class MemoryMailer implements Mailer {
  readonly sent: Mail[] = [];
  async send(mail: Mail): Promise<void> {
    this.sent.push(mail);
  }
  lastTo(address: string): Mail | undefined {
    return [...this.sent].reverse().find((m) => m.to === address);
  }
}

/**
 * Sends through the SMTP server configured in the CMS (or SMTP_URL). Without one,
 * development prints to the console; production refuses, so sign-in codes never land in a log.
 */
export class ConfiguredMailer implements Mailer {
  private transport: { url: string; t: ReturnType<typeof nodemailer.createTransport> } | null = null;
  private readonly fallback = new ConsoleMailer();

  constructor(
    private readonly resolve: () => Promise<{ url?: string; from?: string }>,
    private readonly allowConsole: boolean,
  ) {}

  async send(mail: Mail): Promise<void> {
    const { url, from } = await this.resolve();
    if (!url) {
      if (this.allowConsole) return this.fallback.send(mail);
      throw new Error('outgoing email is not configured (CMS > settings > connections)');
    }
    if (this.transport?.url !== url) this.transport = { url, t: nodemailer.createTransport(url) };
    await this.transport.t.sendMail({ from, ...mail });
  }
}

export class SmtpMailer implements Mailer {
  private readonly transport;
  constructor(
    smtpUrl: string,
    private readonly from: string,
  ) {
    this.transport = nodemailer.createTransport(smtpUrl);
  }
  async send(mail: Mail): Promise<void> {
    await this.transport.sendMail({ from: this.from, ...mail });
  }
}
