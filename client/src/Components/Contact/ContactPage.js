import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { apiUrl } from '../../utils/api';
import SubdomainNav from '../Homepage/SubdomainNav';
import { detectSiteMode } from '../../utils/siteMode';

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
  'w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder-white/30 transition-colors focus:border-[#0a84ff]/50 focus:outline-none focus:ring-2 focus:ring-[#0a84ff]/25';

const labelClass = 'mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-white/50';

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
    setStatus('Sending...');

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

      setStatus('Message sent successfully!');
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
    <div className="relative min-h-screen bg-[#08090c] text-white">
      <SubdomainNav currentMode={siteMode} />

      <main className="relative z-10 mx-auto max-w-7xl px-4 pb-20 pt-28 sm:px-8">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45 }}
          className="mb-10"
        >
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-white/48">
            Get in Touch
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">Contact Me</h1>
          <p className="mt-3 max-w-2xl text-base leading-relaxed text-white/60">
            I'm always open to discussing new projects, creative ideas, or opportunities to be part of your vision.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_1fr]">
          {/* Contact links */}
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.06, duration: 0.45 }}
            className="rounded-[1.75rem] border border-white/10 bg-white/5 p-6 shadow-[0_18px_55px_rgba(0,0,0,0.28)] backdrop-blur-xl sm:p-8"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/48">
              Other Channels
            </p>
            <p className="mt-2 text-sm leading-relaxed text-white/60">
              Feel free to connect directly on any of these platforms.
            </p>

            <div className="mt-6 flex flex-col gap-4">
              {contactLinks.map(({ href, Icon, label, subtext }) => (
                <a
                  key={label}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-center gap-4 rounded-2xl border border-white/8 bg-white/3 px-4 py-3 transition-colors hover:border-white/15 hover:bg-white/8"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/8 text-white/70 transition-colors group-hover:text-white">
                    <Icon />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white">{label}</p>
                    <p className="truncate text-xs text-white/55">{subtext}</p>
                  </div>
                </a>
              ))}
            </div>
          </motion.div>

          {/* Contact form */}
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1, duration: 0.45 }}
            className="rounded-[1.75rem] border border-white/10 bg-white/5 p-6 shadow-[0_18px_55px_rgba(0,0,0,0.28)] backdrop-blur-xl sm:p-8"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/48">
              Send a Message
            </p>

            <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-5">
              <div>
                <label htmlFor="name" className={labelClass}>Full Name</label>
                <input
                  type="text"
                  name="name"
                  id="name"
                  required
                  placeholder="Harrison Martin"
                  value={formData.name}
                  onChange={handleChange}
                  className={inputClass}
                />
              </div>

              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <div>
                  <label htmlFor="email" className={labelClass}>Email Address</label>
                  <input
                    type="email"
                    name="email"
                    id="email"
                    placeholder="you@example.com"
                    value={formData.email}
                    onChange={handleChange}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label htmlFor="phone" className={labelClass}>Phone Number</label>
                  <input
                    type="tel"
                    name="phone"
                    id="phone"
                    placeholder="(123) 456-7890"
                    value={formData.phone}
                    onChange={handleChange}
                    className={inputClass}
                  />
                </div>
              </div>

              <p className="text-xs text-white/40">Please provide either an email or phone number.</p>

              <div>
                <label htmlFor="message" className={labelClass}>Message</label>
                <textarea
                  name="message"
                  id="message"
                  rows="6"
                  required
                  placeholder="Tell me about your project or inquiry..."
                  value={formData.message}
                  onChange={handleChange}
                  className={inputClass}
                />
              </div>

              <div className="flex items-center justify-end gap-4 pt-1">
                {status && (
                  <p className={`text-sm ${status.includes('Error') ? 'text-red-400' : 'text-white/65'}`}>
                    {status}
                  </p>
                )}
                <motion.button
                  type="submit"
                  disabled={isSubmitting}
                  whileHover={{ y: -1 }}
                  whileTap={{ scale: 0.98 }}
                  className="rounded-full bg-[#0a84ff] px-6 py-2.5 text-sm font-semibold text-white shadow-[0_10px_20px_rgba(10,132,255,0.28)] transition-colors hover:bg-[#2997ff] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isSubmitting ? 'Sending...' : 'Send Message'}
                </motion.button>
              </div>
            </form>
          </motion.div>
        </div>

        {/* Resume */}
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.16, duration: 0.45 }}
          className="mt-6 rounded-[1.75rem] border border-white/10 bg-white/5 p-6 shadow-[0_18px_55px_rgba(0,0,0,0.28)] backdrop-blur-xl sm:p-8"
        >
          <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/48">Resume</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight">Download my resume</h2>
              <p className="mt-1 text-sm text-white/60">
                A detailed overview of my skills and work experience.
              </p>
            </div>
            <a href="/harrison-martin-resume.pdf" download="Harrison-Martin-Resume.pdf" className="shrink-0">
              <motion.div
                whileHover={{ y: -1 }}
                whileTap={{ scale: 0.98 }}
                className="inline-flex items-center gap-2.5 rounded-full border border-white/12 bg-white/8 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/14"
              >
                <DownloadIcon />
                Download PDF
              </motion.div>
            </a>
          </div>
        </motion.div>
      </main>
    </div>
  );
};

export default ContactPage;
