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
