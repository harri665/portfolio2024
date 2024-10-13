const fs = require('fs');
const fetch = require('node-fetch');

const username = 'harr1'; // Replace with your ArtStation username
const url = `https://www.artstation.com/users/${username}/projects.json`;

async function fetchArtStationProjects() {
  try {
    const response = await fetch(url);
    const data = await response.json();

    if (data.data && data.data.length > 0) {
      // Write the fetched data to a local JSON file
      fs.writeFileSync('./public/artstation-projects.json', JSON.stringify(data.data, null, 2));
      console.log('ArtStation data saved to public/artstation-projects.json');
    } else {
      console.error('No projects found for the user.');
    }
  } catch (error) {
    console.error('Error fetching ArtStation data:', error);
  }
}

fetchArtStationProjects();
