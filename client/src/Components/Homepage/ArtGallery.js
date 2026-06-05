import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import SubdomainNav from './SubdomainNav';
import { SITE_MODES } from '../../utils/siteMode';
import './gallery.css';

const TINTS = [
  '#171419', '#13161c', '#181414', '#131a18',
  '#16131c', '#1a1714', '#13181c', '#191317',
];

const SOFTWARE = {
  blender:      { ab: 'Bl', fg: '#ec7a1c', slug: 'blender' },
  houdini:      { ab: 'H',  fg: '#ff7a2f', slug: 'houdini' },
  painter:      { ab: 'Pt', fg: '#4fd07a', slug: '' },
  zbrush:       { ab: 'Zb', fg: '#d6a06a', slug: '' },
  photoshop:    { ab: 'Ps', fg: '#31a8ff', slug: '' },
  premiere:     { ab: 'Pr', fg: '#b39cff', slug: '' },
  aftereffects: { ab: 'Ae', fg: '#c89cff', slug: '' },
  nuke:         { ab: 'Nk', fg: '#f5c84b', slug: 'nuke' },
  unreal:       { ab: 'Ue', fg: '#cdd0ff', slug: 'unrealengine' },
  maya:         { ab: 'My', fg: '#3fb6c9', slug: 'autodeskmaya' },
};

const WORKS = [
  { t: 'Train Heist Short Animation', video: true, sw: ['blender','houdini','premiere','aftereffects'],
    img: 'https://cdna.artstation.com/p/assets/covers/images/087/345/632/small_square/harri-harri-timeline-17-frame-at-0m5s.jpg?1745531768',
    url: 'https://www.artstation.com/artwork/YG6eN3', assets: 6, likes: 2, d: '' },
  { t: 'Beating Heart on Fire', video: true, sw: ['blender','houdini','aftereffects'],
    img: 'https://cdnb.artstation.com/p/assets/images/images/091/843/023/small_square/harri-0118.jpg?1757968844',
    url: 'https://www.artstation.com/artwork/Bkl5Yr', assets: 3, likes: 2, d: '' },
  { t: 'IXPE Data Visualization', video: true, sw: ['houdini','blender'],
    img: 'https://cdnb.artstation.com/p/assets/images/images/091/763/703/small_square/harri-screenshot-2025-09-12-140418.jpg?1757707477',
    url: 'https://www.artstation.com/artwork/8Bvxdn', assets: 9, likes: 4,
    d: 'Visualizes the magnetic field of a neutron star using NASA IXPE data. Houdini VDB tools build the smoke field and interpolate extra points from the data; final render in Blender.' },
  { t: 'Trex', video: true, sw: ['blender','houdini','painter'],
    img: 'https://cdna.artstation.com/p/assets/images/images/094/040/704/small_square/harri-dino0025.jpg?1764267802',
    url: 'https://www.artstation.com/artwork/5WxWAz', assets: 3, likes: 3, d: '' },
  { t: 'Benson Boone WIP', sw: ['blender','zbrush','painter'],
    img: 'https://cdna.artstation.com/p/assets/images/images/084/878/808/small_square/harri-untitled15.jpg?1739406617',
    url: 'https://www.artstation.com/artwork/8BP25Q', assets: 5, likes: 2, d: '' },
  { t: 'Camping Tent', video: true, sw: ['blender','houdini','painter'],
    img: 'https://cdna.artstation.com/p/assets/video_clips/images/087/474/010/small_square/harri-thumb.jpg?1745887579',
    url: 'https://www.artstation.com/artwork/ZlBz9G', assets: 1, likes: 1,
    d: 'A detailed render for Madix Outdoors\' upcoming popup tent — asset modeling in Blender, dynamic cloth sim in Houdini, and realistic texturing in Substance.' },
  { t: 'Wolf Spider (Hogna Aspersa)', sw: ['blender','unreal'],
    img: 'https://cdna.artstation.com/p/assets/images/images/084/363/186/small_square/harri-spiderrender3.jpg?1738177916',
    url: 'https://www.artstation.com/artwork/x3Na22', assets: 6, likes: 2,
    d: 'Virtual spiders that replicate real-life motion for AIMRL — built to train an AI to recognize and drive a micro-robot. Modeled in Blender, 30+ hand-animated templates simulated in Unreal Engine.' },
  { t: 'Chappell Roan at the VMAs', sw: ['blender','painter'],
    img: 'https://cdnb.artstation.com/p/assets/images/images/081/398/697/small_square/harri-render2.jpg?1730156809',
    url: 'https://www.artstation.com/artwork/wrOzd5', assets: 2, likes: 1, d: '' },
  { t: 'Fire Tornado', video: true, sw: ['houdini','blender'],
    img: 'https://cdnb.artstation.com/p/assets/video_clips/images/078/247/277/small_square/harri-thumb.jpg?1721613180',
    url: 'https://www.artstation.com/artwork/g0ZEnE', assets: 1, likes: 4,
    d: 'Learning Pyro simulation in Houdini — and making a cool-looking fire tornado along the way.' },
  { t: 'Mocap and Simulation', video: true, sw: ['houdini','blender'],
    img: 'https://cdnb.artstation.com/p/assets/video_clips/images/078/247/243/small_square/harri-thumb.jpg?1721613065',
    url: 'https://www.artstation.com/artwork/BXxZKr', assets: 2, likes: 2, d: '' },
  { t: 'Water Planet Sim', video: true, sw: ['houdini','blender'],
    img: 'https://cdna.artstation.com/p/assets/covers/images/078/246/874/small_square/harri-harri-thumb.jpg?1721611693',
    url: 'https://www.artstation.com/artwork/PXzlDn', assets: 2, likes: 2,
    d: 'An abstract water-planet simulation built with Houdini\'s FLIP water system.' },
  { t: 'Jaeger - Pacific Rim', video: true, sw: ['blender','painter'],
    img: 'https://cdnb.artstation.com/p/assets/images/images/063/631/107/20230605135702/small_square/harri-rdt-20230208-212005426228820742689064.jpg?1685991422',
    url: 'https://www.artstation.com/artwork/blJvrE', assets: 4, likes: 4, d: '' },
  { t: 'Roam VR Room', sw: ['blender','painter'],
    img: 'https://cdna.artstation.com/p/assets/images/images/092/634/308/small_square/harri-vrroom.jpg?1760208863',
    url: 'https://www.artstation.com/artwork/4N5KY1', assets: 1, likes: 2, d: '' },
  { t: 'Titanfall Titan', video: true, sw: ['blender','painter'],
    img: 'https://cdna.artstation.com/p/assets/images/images/063/630/778/small_square/harri-untitled.jpg?1685990856',
    url: 'https://www.artstation.com/artwork/LR8ykv', assets: 4, likes: 1, d: '' },
  { t: 'Girl with Robot Arms', sw: ['blender','zbrush','painter'],
    img: 'https://cdnb.artstation.com/p/assets/images/images/070/159/287/small_square/harri-girlrobotarms.jpg?1701882861',
    url: 'https://www.artstation.com/artwork/8bgGJG', assets: 4, likes: 1, d: '' },
  { t: 'Vi - Arcane', video: true, sw: ['blender','zbrush','painter'],
    img: 'https://cdnb.artstation.com/p/assets/images/images/074/244/749/small_square/harri-viface.jpg?1711573575',
    url: 'https://www.artstation.com/artwork/PX3WRy', assets: 3, likes: 2, d: '' },
  { t: 'Buggy Driving Over Dune', video: true, sw: ['blender','houdini'],
    img: 'https://cdnb.artstation.com/p/assets/images/images/081/547/757/small_square/harri-0044.jpg?1730572570',
    url: 'https://www.artstation.com/artwork/L4Z4aA', assets: 2, likes: 1, d: '' },
  { t: 'Steampunk Scene', sw: ['blender','painter'],
    img: 'https://cdna.artstation.com/p/assets/images/images/049/174/190/small_square/harri-1-1.jpg?1651850510',
    url: 'https://www.artstation.com/artwork/G8J3xV', assets: 1, likes: 7, d: '' },
  { t: 'Robot Head', sw: ['blender','painter'],
    img: 'https://cdna.artstation.com/p/assets/images/images/074/243/594/small_square/harri-untitled.jpg?1711571286',
    url: 'https://www.artstation.com/artwork/dKNkWw', assets: 1, likes: 1, d: '' },
  { t: 'SRL Intro Animation', video: true, sw: ['blender','aftereffects'],
    img: 'https://cdna.artstation.com/p/assets/covers/images/072/037/714/small_square/harri-harri-screenshot-2024-01-28-225718.jpg?1706507884',
    url: 'https://www.artstation.com/artwork/LRd19v', assets: 1, likes: 2, d: '' },
  { t: 'Apocalypse City', sw: ['blender','painter'],
    img: 'https://cdna.artstation.com/p/assets/images/images/063/629/540/20230605131533/small_square/harri-main.jpg?1685988934',
    url: 'https://www.artstation.com/artwork/YBRveY', assets: 2, likes: 2, d: '' },
  { t: 'Cyclops', sw: ['blender','zbrush','painter'],
    img: 'https://cdna.artstation.com/p/assets/images/images/063/629/602/small_square/harri-main.jpg?1685989013',
    url: 'https://www.artstation.com/artwork/dKgV0J', assets: 3, likes: 2, d: '' },
  { t: 'Steampunk Robot Face', video: true, sw: ['blender','painter'],
    img: 'https://cdnb.artstation.com/p/assets/video_clips/images/048/711/027/small_square/harri-thumb.jpg?1650730763',
    url: 'https://www.artstation.com/artwork/YKzxgd', assets: 2, likes: 7, d: '' },
  { t: 'Gemini Titan', video: true, sw: ['blender','painter'],
    img: 'https://cdna.artstation.com/p/assets/images/images/049/174/296/small_square/harri-gemini.jpg?1651850684',
    url: 'https://www.artstation.com/artwork/B3zKgr', assets: 2, likes: 4,
    d: '3D model of concept art originally drawn by u/Wolfdawgartcorner.' },
];

function ToolBadge({ k }) {
  const s = SOFTWARE[k];
  const [failed, setFailed] = useState(false);
  if (!s) return null;
  const useIcon = s.slug && !failed;
  return (
    <span className="nf-tool" title={k} style={{ color: s.fg }}>
      {useIcon
        ? <img
            className="nf-tool-img"
            alt={k}
            src={`https://cdn.simpleicons.org/${s.slug}/${s.fg.replace('#', '')}`}
            onError={() => setFailed(true)}
          />
        : s.ab}
    </span>
  );
}

function GRCard({ p, i }) {
  const hashId = p.url.split('/').pop();
  const desc = p.d || `${p.assets} ${p.assets === 1 ? 'asset' : 'assets'} · ${p.likes} ${p.likes === 1 ? 'like' : 'likes'} · view the full project on ArtStation.`;

  return (
    <Link to={`/${hashId}`} className="gr-card">
      <div className="gr-thumb" style={{ '--tint': TINTS[i % TINTS.length] }}>
        <img
          className="gr-img"
          src={p.img}
          alt={p.t}
          loading="lazy"
          onError={(e) => { e.currentTarget.style.display = 'none'; }}
        />
        {p.video && <span className="gr-vid">&#9654; video</span>}
        <div className="nf-tools gr-toolpos">
          {p.sw.map((k) => <ToolBadge key={k} k={k} />)}
        </div>
        <div className="gr-reveal">
          <span className="gr-rev-title">{p.t}</span>
          <p>{desc}</p>
          <span className="gr-link">View Details →</span>
        </div>
      </div>
      <div className="gr-meta">
        <span className="gr-name">{p.t}</span>
        <span className="gr-arrow">→</span>
      </div>
    </Link>
  );
}

export default function ArtGallery() {
  return (
    <div className="gx nf gr">
      <div className="nf-dots" aria-hidden="true" />
      <SubdomainNav currentMode={SITE_MODES.ART} />
      <div className="gx-shell" style={{ paddingTop: '108px' }}>
        <header className="nf-head">
          <div className="nf-eyebrow">3D Art</div>
          <h1 className="nf-title">Selected work.</h1>
          <p className="nf-meta">{WORKS.length} projects · pulled from ArtStation</p>
        </header>
        <div className="gr-grid">
          {WORKS.map((p, i) => <GRCard key={p.url} p={p} i={i} />)}
        </div>
      </div>
    </div>
  );
}
