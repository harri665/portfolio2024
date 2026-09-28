import React, { useState } from 'react';
import { apiUrl } from '../../utils/api';
import SubdomainNav from '../Homepage/SubdomainNav';
import { detectSiteMode } from '../../utils/siteMode';
import Button from '../ui/Button';
import Container from '../ui/Container';

const MailIcon = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <rect width="20" height="16" x="2" y="4" rx="2" />
    <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
  </svg>
);

const LinkedinIcon = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" />
    <rect width="4" height="12" x="2" y="9" />
    <circle cx="4" cy="4" r="2" />
  </svg>
);

const GithubIcon = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
  </svg>
);

const PhoneIcon = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
  </svg>
);

const DownloadIcon = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

const inputClass =
  'w-full rounded-field border border-line/12 bg-surface px-4 py-3 text-sm text-ink placeholder:text-ink-3 transition-colors focus:border-accent/60 focus:outline-none';

const labelClass = 'mb-2 block text-sm font-medium text-ink-2';

const panelClass = 'rounded-card border border-line/9 bg-surface/85 p-6 sm:p-8';

const ContactPage = () => {
  const siteMode = detectSiteMode();

  const contactLinks = [
    { href: 'mailto:harrison.d.martin@gmail.com', Icon: MailIcon, label: 'Email', subtext: 'harrison.d.martin@gmail.com' },
    { href: 'tel:3038842648', Icon: PhoneIcon, label: 'Phone', subtext: '303-884-2648' },
    { href: 'https://www.linkedin.com/in/harrison-martin-27/', Icon: LinkedinIcon, label: 'LinkedIn', subtext: 'Harrison Martin' },
    { href: 'https://github.com/harri665', Icon: GithubIcon, label: 'GitHub', subtext: 'harri665' },
  ];

  const [formData, setFormData] = useState({ name: '', email: '', message: '', phone: '' });
  const [status, setStatus] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!formData.email && !formData.phone) {
      setStatus('Error: Please provide either an email or a phone number.');
      setTimeout(() => setStatus(''), 5000);
      return;
    }

    setIsSubmitting(true);
    setStatus('Sending…');

    let discordMessage = `> **New Contact Form Submission!**\n>\n> **Name:** ${formData.name}`;
    if (formData.email) discordMessage += `\n> **Email:** ${formData.email}`;
    if (formData.phone) discordMessage += `\n> **Phone:** ${formData.phone}`;
    discordMessage += `\n>\n> **Message:**\n> ${formData.message}`;

    try {
      const response = await fetch(apiUrl('/discord/dm'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: discordMessage }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Network response was not ok');
      }

      setStatus('Sent. I’ll get back to you soon.');
      setFormData({ name: '', email: '', message: '', phone: '' });
    } catch (error) {
      console.error('Failed to send message:', error);
      setStatus(`Error: ${error.message}`);
    } finally {
      setIsSubmitting(false);
      setTimeout(() => setStatus(''), 5000);
    }
  };

  return (
    <div className="relative min-h-screen bg-bg text-ink">
      <SubdomainNav currentMode={siteMode} />

      <Container as="main" className="pb-24 pt-28 sm:pt-32">
        <header className="mb-10">
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Contact</h1>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-ink-2">
            Email is the quickest way to reach me. The form sends me a message directly.
          </p>
        </header>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[320px_1fr]">
          <section className={panelClass} aria-label="Contact details">
            <ul className="flex flex-col gap-3">
              {contactLinks.map(({ href, Icon, label, subtext }) => (
                <li key={label}>
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex items-center gap-4 rounded-field px-2 py-2 transition-colors hover:bg-line/6"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-field border border-line/12 text-ink-2 transition-colors group-hover:text-ink">
                      <Icon />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-ink">{label}</span>
                      <span className="block truncate text-sm text-ink-3">{subtext}</span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </section>

          <section className={panelClass}>
            <h2 className="text-xl font-semibold tracking-tight">Send a message</h2>

            <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-5">
              <div>
                <label htmlFor="name" className={labelClass}>Name</label>
                <input
                  type="text"
                  name="name"
                  id="name"
                  required
                  autoComplete="name"
                  placeholder="Your name"
                  value={formData.name}
                  onChange={handleChange}
                  className={inputClass}
                />
              </div>

              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <div>
                  <label htmlFor="email" className={labelClass}>Email</label>
                  <input
                    type="email"
                    name="email"
                    id="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    value={formData.email}
                    onChange={handleChange}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label htmlFor="phone" className={labelClass}>Phone</label>
                  <input
                    type="tel"
                    name="phone"
                    id="phone"
                    autoComplete="tel"
                    placeholder="(123) 456-7890"
                    value={formData.phone}
                    onChange={handleChange}
                    className={inputClass}
                  />
                </div>
              </div>

              <p className="-mt-2 text-sm text-ink-3">Leave an email or a phone number so I can reply.</p>

              <div>
                <label htmlFor="message" className={labelClass}>Message</label>
                <textarea
                  name="message"
                  id="message"
                  rows="6"
                  required
                  placeholder="What would you like to talk about?"
                  value={formData.message}
                  onChange={handleChange}
                  className={inputClass}
                />
              </div>

              <div className="flex flex-wrap items-center justify-end gap-4 pt-1">
                {status && (
                  <p role="status" className={`text-sm ${status.includes('Error') ? 'text-red-300' : 'text-ink-2'}`}>
                    {status}
                  </p>
                )}
                <Button type="submit" variant="primary" disabled={isSubmitting}>
                  {isSubmitting ? 'Sending…' : 'Send message'}
                </Button>
              </div>
            </form>
          </section>
        </div>

        <section className={`${panelClass} mt-5 flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between`}>
          <div>
            <h2 className="text-xl font-semibold tracking-tight">Resume</h2>
            <p className="mt-1 text-sm text-ink-2">Experience, skills, and education as a PDF.</p>
          </div>
          <Button href="/harrison-martin-resume.pdf" download="Harrison-Martin-Resume.pdf" className="shrink-0">
            <DownloadIcon />
            Download PDF
          </Button>
        </section>
      </Container>
    </div>
  );
};

export default ContactPage;
