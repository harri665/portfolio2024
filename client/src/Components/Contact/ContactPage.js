import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { apiUrl } from '../../utils/api';

//==============================================================================
// 1. SVG Icons for Social Links & Actions
//==============================================================================

const MailIcon = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <rect width="20" height="16" x="2" y="4" rx="2"></rect>
    <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"></path>
  </svg>
);

const LinkedinIcon = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"></path>
    <rect width="4" height="12" x="2" y="9"></rect>
    <circle cx="4" cy="4" r="2"></circle>
  </svg>
);

const GithubIcon = (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
        <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path>
    </svg>
);

const PhoneIcon = (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
    </svg>
);

const DownloadIcon = (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
        <polyline points="7 10 12 15 17 10"></polyline>
        <line x1="12" y1="15" x2="12" y2="3"></line>
    </svg>
);

const ArrowLeftIcon = (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
        <line x1="19" y1="12" x2="5" y2="12"></line>
        <polyline points="12 19 5 12 12 5"></polyline>
    </svg>
);


//==============================================================================
// 2. Contact Page Component
//==============================================================================
const ContactPage = () => {
  // --- UPDATED: Contact links with new info ---
  const contactLinks = [
    { href: "mailto:harrison.d.martin@gmail.com", Icon: MailIcon, label: "Email", subtext: "harrison.d.martin@gmail.com" },
    { href: "tel:3038842648", Icon: PhoneIcon, label: "Phone", subtext: "303-884-2648" },
    { href: "https://www.linkedin.com/in/harrison-martin-27/", Icon: LinkedinIcon, label: "LinkedIn", subtext: "Harrison Martin" },
    { href: "https://github.com/harri665", Icon: GithubIcon, label: "GitHub", subtext: "harri665" },
  ];

  const [formData, setFormData] = useState({ name: '', email: '', message: '', phone: '' });
  const [status, setStatus] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prevData => ({ ...prevData, [name]: value }));
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

    let discordMessage = `
> **New Contact Form Submission!**
> 
> **Name:** ${formData.name}`;
    if (formData.email) {
        discordMessage += `\n> **Email:** ${formData.email}`;
    }
    if (formData.phone) {
        discordMessage += `\n> **Phone:** ${formData.phone}`;
    }
    discordMessage += `
> 
> **Message:**
> ${formData.message}
    `;

    try {
      const response = await fetch(apiUrl('/discord/dm'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: discordMessage,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Network response was not ok');
      }

      setStatus('Message sent successfully! 🎉');
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
    <motion.div
      className="bg-gray-900 text-white min-h-screen py-20 px-4 sm:px-6 lg:px-8 relative"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.8 }}
    >
      <div className="absolute top-6 left-4 sm:top-8 sm:left-8 z-10">
          <Link to="/">
              <motion.button
                  className="inline-flex items-center gap-2 text-gray-400 hover:text-white transition-colors duration-300"
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  aria-label="Go back to homepage"
              >
                  <ArrowLeftIcon className="w-6 h-6" />
                  <span className="font-semibold hidden sm:inline">Back</span>
              </motion.button>
          </Link>
      </div>

      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-16">
          <h1 className="text-5xl font-bold tracking-tight mb-4">Contact Me</h1>
          <p className="text-lg text-gray-400 max-w-2xl mx-auto">
            I'm always open to discussing new projects, creative ideas, or opportunities to be part of your vision.
          </p>
        </div>

        <div className="flex flex-col lg:flex-row gap-16">
          
          <div className="lg:w-1/3 text-center lg:text-left">
            <h2 className="text-3xl font-bold tracking-tight mb-4">Other Channels</h2>
            <p className="text-lg text-gray-400 mb-8">
                Or, feel free to connect with me directly on other platforms.
            </p>
            {/* --- UPDATED: Vertical contact links with subtext --- */}
            <div className="flex flex-col items-center lg:items-start gap-8">
              {contactLinks.map(({ href, Icon, label, subtext }) => (
                <a key={label} href={href} target="_blank" rel="noopener noreferrer" aria-label={label} className="flex items-center gap-4 text-gray-400 hover:text-white transition-colors duration-300 group">
                  <Icon className="w-8 h-8 text-gray-500 group-hover:text-white transition-colors duration-300" />
                  <div>
                    <span className="font-semibold text-lg text-white">{label}</span>
                    <p className="text-sm text-gray-400">{subtext}</p>
                  </div>
                </a>
              ))}
            </div>
          </div>

          <div className="lg:w-2/3">
            <div className="bg-gray-800 p-8 rounded-lg shadow-2xl">
              <form onSubmit={handleSubmit}>
                <div className="grid grid-cols-1 gap-6">
                  <div>
                    <label htmlFor="name" className="block text-sm font-medium text-gray-300 mb-2">Full Name</label>
                    <input type="text" name="name" id="name" required className="w-full bg-gray-700 border-gray-600 text-white rounded-md py-3 px-4 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition" placeholder="Harrison Martin"
                      value={formData.name}
                      onChange={handleChange}
                    />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div>
                        <label htmlFor="email" className="block text-sm font-medium text-gray-300 mb-2">Email Address</label>
                        <input type="email" name="email" id="email" className="w-full bg-gray-700 border-gray-600 text-white rounded-md py-3 px-4 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition" placeholder="you@example.com"
                          value={formData.email}
                          onChange={handleChange}
                        />
                      </div>
                      <div>
                        <label htmlFor="phone" className="block text-sm font-medium text-gray-300 mb-2">Phone Number</label>
                        <input type="tel" name="phone" id="phone" className="w-full bg-gray-700 border-gray-600 text-white rounded-md py-3 px-4 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition" placeholder="(123) 456-7890"
                          value={formData.phone}
                          onChange={handleChange}
                        />
                      </div>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400 -mt-4">Please provide either an email or phone number.</p>
                  </div>
                </div>
                <div className="mt-6">
                  <label htmlFor="message" className="block text-sm font-medium text-gray-300 mb-2">Message</label>
                  <textarea name="message" id="message" rows="6" required className="w-full bg-gray-700 border-gray-600 text-white rounded-md py-3 px-4 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition" placeholder="Tell me about your project or inquiry..."
                    value={formData.message}
                    onChange={handleChange}
                  ></textarea>
                </div>
                <div className="mt-8 flex items-center justify-end gap-4">
                  {status && (
                    <p className={`text-sm ${status.includes('Error') ? 'text-red-400' : 'text-gray-300'}`}>
                      {status}
                    </p>
                  )}
                  <motion.button type="submit" className="bg-white text-gray-900 font-semibold py-3 px-8 rounded-full shadow-xl hover:bg-gray-200 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed" whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? 'Sending...' : 'Send Message'}
                  </motion.button>
                </div>
              </form>
            </div>
          </div>
        </div>

        <div className="text-center mt-24 border-t border-gray-800 pt-12">
            <h2 className="text-3xl font-bold tracking-tight mb-4">My Resume</h2>
            <p className="text-lg text-gray-400 mb-8 max-w-xl mx-auto">
                For a detailed overview of my skills and work experience, please download my resume.
            </p>
            <a href="/harrison-martin-resume.pdf" download="Harrison-Martin-Resume.pdf">
                <motion.button className="inline-flex items-center gap-3 bg-white text-gray-900 font-semibold py-3 px-8 rounded-full shadow-xl hover:bg-gray-200 transition-all duration-300" whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                    <DownloadIcon className="w-5 h-5" />
                    Download Resume
                </motion.button>
            </a>
        </div>
      </div>
    </motion.div>
  );
};

export default ContactPage;
