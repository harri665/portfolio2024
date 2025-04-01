import React, { useState, useEffect } from 'react';

const LogsViewer = ({ initialLogs }) => {
  // State to hold all logs
  const [logs, setLogs] = useState([]);

  // State to track which IP cards are expanded
  const [expandedIPs, setExpandedIPs] = useState({});

  useEffect(() => {
    // Suppose 'initialLogs' is the JSON array you already have.
    // If you want to load from an endpoint, replace this with a fetch call.
    setLogs(initialLogs);
  }, [initialLogs]);

  // Group logs by IP address
  const groupedByIP = logs.reduce((acc, log) => {
    const ip = log.ip || 'Unknown IP';
    if (!acc[ip]) {
      acc[ip] = [];
    }
    acc[ip].push(log);
    return acc;
  }, {});

  // Convert the groups into an array so we can sort them
  const ipGroups = Object.entries(groupedByIP).map(([ip, logsForIP]) => {
    // Sort each IP's logs from newest to oldest
    const sortedLogs = [...logsForIP].sort(
      (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
    );

    // Track the newest timestamp to sort IP groups themselves
    const newestTimestamp = sortedLogs[0].timestamp;

    return {
      ip,
      logs: sortedLogs,
      newestTimestamp,
    };
  });

  // Sort the IP groups by their newest timestamp (descending)
  ipGroups.sort(
    (a, b) => new Date(b.newestTimestamp) - new Date(a.newestTimestamp)
  );

  // Toggle expand/collapse for an IP card
  const toggleExpand = (ip) => {
    setExpandedIPs((prev) => ({
      ...prev,
      [ip]: !prev[ip],
    }));
  };

  return (
    <div style={{ maxWidth: '600px', margin: '0 auto' }}>
      <h2>Logs</h2>
      {ipGroups.map((group) => {
        const { ip, logs: sortedLogs } = group;
        const isExpanded = expandedIPs[ip] || false;

        return (
          <div
            key={ip}
            style={{
              border: '1px solid #ccc',
              borderRadius: '4px',
              marginBottom: '10px',
              padding: '10px',
            }}
          >
            {/* Card Header */}
            <div
              style={{ fontWeight: 'bold', cursor: 'pointer' }}
              onClick={() => toggleExpand(ip)}
            >
              <span>IP Address: {ip}</span>
              &nbsp;|&nbsp;
              <span>Last Access: {new Date(sortedLogs[0].timestamp).toLocaleString()}</span>
            </div>

            {/* Card Body (collapsible) */}
            {isExpanded && (
              <div style={{ marginTop: '10px' }}>
                {sortedLogs.map((log) => (
                  <div
                    key={log.timestamp}
                    style={{
                      padding: '8px 0',
                      borderBottom: '1px solid #eee',
                    }}
                  >
                    <div><strong>Timestamp:</strong> {new Date(log.timestamp).toLocaleString()}</div>
                    <div><strong>Page Accessed:</strong> {log.pageAccessed}</div>
                    <div>
                      <strong>Device/Browser:</strong> {log.device} / {log.browser}
                    </div>
                    <div><strong>Platform:</strong> {log.platform}</div>
                    <div>
                      <strong>Location:</strong> {log.location?.status === 'fail' 
                        ? log.location?.message 
                        : JSON.stringify(log.location, null, 2)
                      }
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default LogsViewer;
