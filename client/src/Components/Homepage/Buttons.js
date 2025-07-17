import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom'; // Import Link for internal navigation
import { motion, AnimatePresence } from 'framer-motion';

//==============================================================================
// 1. Reusable Button/Link Component
//==============================================================================
/**
 * A reusable, animated component that can render as a <button>, an <a> tag for
 * external links, or a React Router <Link> for internal navigation.
 * @param {object} props
 * @param {function} [props.onClick] - Function for standard button actions.
 * @param {string} [props.href] - URL for external links (e.g., 'https://...' or 'mailto:').
 * @param {string} [props.to] - Path for internal navigation (e.g., '/contact').
 * @param {React.ReactNode} props.children - The content to display inside the button.
 * @param {string} [props.className] - Additional Tailwind CSS classes for custom styling.
 */
const ActionButton = ({ children, onClick, className = '', href, to }) => {
  const baseClasses = "px-8 py-3 rounded-full font-semibold shadow-xl transition-colors duration-300 inline-block text-center";
  const motionProps = {
    whileHover: { scale: 1.05 },
    whileTap: { scale: 0.95 },
    transition: { type: "spring", stiffness: 400, damping: 17 }
  };

  // Render a React Router <Link> for internal navigation
  if (to) {
    return (
      <Link to={to}>
        <motion.div className={`${baseClasses} ${className}`} {...motionProps}>
          {children}
        </motion.div>
      </Link>
    );
  }

  // Render a standard <a> tag for external links
  if (href) {
    return (
      <motion.a href={href} className={`${baseClasses} ${className}`} {...motionProps}>
        {children}
      </motion.a>
    );
  }

  // Default to a <button> for onClick actions
  return (
    <motion.button onClick={onClick} className={`${baseClasses} ${className}`} {...motionProps}>
      {children}
    </motion.button>
  );
};


//==============================================================================
// 2. Main Component with Scroll Logic and Portal
//==============================================================================
const Buttons = () => {
  const [showFloatingButton, setShowFloatingButton] = useState(false);
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
    const handleScroll = () => {
      if (window.scrollY > 400) {
        setShowFloatingButton(true);
      } else {
        setShowFloatingButton(false);
      }
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToSection = (id) => {
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <>
      {/* Initial buttons displayed in the hero section */}
      <div className="mt-8 flex flex-col sm:flex-row justify-center items-center gap-4">
        <ActionButton
          onClick={() => scrollToSection('projects')}
          className="bg-white text-gray-900 hover:bg-gray-200"
        >
          Explore My Work
        </ActionButton>
        {/* UPDATED: This now uses <Link> for smooth client-side navigation */}
        <ActionButton
          to="/contact"
          className="bg-gray-700 text-white hover:bg-gray-600"
        >
          Contact Me
        </ActionButton>
      </div>

      {/* Floating "Contact Me" button rendered via a Portal */}
      {isClient && createPortal(
        <AnimatePresence>
          {showFloatingButton && (
            <motion.div
              className="fixed bottom-6 right-6 z-50"
              initial={{ opacity: 0, y: 50 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 50 }}
              transition={{ type: 'spring', stiffness: 200, damping: 20 }}
            >
              {/* UPDATED: This floating button also uses <Link> */}
              <ActionButton
                to="/contact"
                className="bg-white text-gray-900 hover:bg-gray-200 !px-6"
              >
                Contact Me
              </ActionButton>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </>
  );
};

export default Buttons;
