const audio = document.getElementById('audio');

const playBtn = document.getElementById('play');

const nextBtn = document.getElementById('next');

const prevBtn = document.getElementById('prev');

const title = document.getElementById('title');

const artist = document.getElementById('artist');

const cover = document.getElementById('cover');

const playlistEl = document.getElementById('playlist');

const statusText = document.getElementById('status');

let songs = [];

let current = 0;


async function loadSongs() {

  try {

    statusText.textContent = 'Carregando playlist...';

    const response = await fetch('music.json');

    songs = await response.json();

    renderPlaylist();

    loadSong(current);

    statusText.textContent = 'Playlist carregada';

  } catch (error) {

    console.error(error);

    statusText.textContent = 'Erro ao carregar playlist';

  }

}


function loadSong(index) {

  const song = songs[index];

  if (!song) return;

  audio.pause();

  audio.src = song.url;

  audio.load();

  title.textContent = song.title;

  artist.textContent = song.artist;

  cover.src = song.cover;

  statusText.textContent = 'Música carregada';

}


function renderPlaylist() {

  playlistEl.innerHTML = '';

  songs.forEach((song, index) => {

    const li = document.createElement('li');

    li.innerHTML = `
      <strong>${song.title}</strong>
      <br>
      ${song.artist}
    `;

    li.onclick = async () => {

      current = index;

      loadSong(current);

      try {

        await audio.play();

        playBtn.textContent = '⏸';

        statusText.textContent = 'Tocando';

      } catch (error) {

        console.error(error);

        statusText.textContent = 'Erro ao tocar áudio';

      }

    };

    playlistEl.appendChild(li);

  });

}


playBtn.onclick = async () => {

  try {

    if (audio.paused) {

      await audio.play();

      playBtn.textContent = '⏸';

      statusText.textContent = 'Tocando';

    } else {

      audio.pause();

      playBtn.textContent = '▶';

      statusText.textContent = 'Pausado';

    }

  } catch (error) {

    console.error(error);

    statusText.textContent = 'Erro ao tocar';

  }

};


nextBtn.onclick = async () => {

  current = (current + 1) % songs.length;

  loadSong(current);

  await audio.play();

};


prevBtn.onclick = async () => {

  current = (current - 1 + songs.length) % songs.length;

  loadSong(current);

  await audio.play();

};


audio.addEventListener('ended', () => {

  nextBtn.click();

});


audio.addEventListener('error', () => {

  statusText.textContent = 'Google Drive bloqueou o streaming';

  console.log(audio.error);

});


loadSongs();
