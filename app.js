const audio = document.getElementById('audio');

const playBtn = document.getElementById('play');

const nextBtn = document.getElementById('next');

const prevBtn = document.getElementById('prev');

const title = document.getElementById('title');

const artist = document.getElementById('artist');

const cover = document.getElementById('cover');

const playlistEl = document.getElementById('playlist');

const searchInput = document.getElementById('search');

const progress = document.getElementById('progress');

const currentTimeEl = document.getElementById('current-time');

const durationEl = document.getElementById('duration');


let songs = [];

let filteredSongs = [];

let current = 0;


async function loadSongs() {

  const response =
  await fetch('music.json');

  songs =
  await response.json();

  filteredSongs = songs;

  renderPlaylist();

  loadSong(current);

}


function loadSong(index) {

  const song = songs[index];

  if (!song) return;

  audio.src = song.url;

  audio.load();

  title.textContent = song.title;

  artist.textContent = song.artist;

  cover.src = song.cover;

}


function renderPlaylist() {

  playlistEl.innerHTML = '';

  filteredSongs.forEach(song => {

    const originalIndex =
    songs.indexOf(song);


    const li =
    document.createElement('li');


    li.innerHTML = `

      <img
        class="playlist-cover"
        src="${song.cover}"
      >

      <div class="song-text">

        <h3>${song.title}</h3>

        <p>${song.artist}</p>

      </div>

      <div class="song-menu">
        ⋮
      </div>

    `;


    li.onclick = async () => {

      current = originalIndex;

      loadSong(current);

      await audio.play();

      playBtn.textContent = '⏸';

    };


    playlistEl.appendChild(li);

  });

}


playBtn.onclick = async () => {

  if (audio.paused) {

    await audio.play();

    playBtn.textContent = '⏸';

  } else {

    audio.pause();

    playBtn.textContent = '▶';

  }

};


nextBtn.onclick = async () => {

  current =
  (current + 1) % songs.length;

  loadSong(current);

  await audio.play();

};


prevBtn.onclick = async () => {

  current =
  (current - 1 + songs.length)
  % songs.length;

  loadSong(current);

  await audio.play();

};


audio.addEventListener(
  'timeupdate',
  () => {

    const progressPercent =
    (audio.currentTime / audio.duration)
    * 100;

    progress.value =
    progressPercent || 0;


    currentTimeEl.textContent =
    formatTime(audio.currentTime);


    durationEl.textContent =
    formatTime(audio.duration);

  }
);


progress.addEventListener(
  'input',
  () => {

    const seekTime =
    (progress.value / 100)
    * audio.duration;

    audio.currentTime = seekTime;

  }
);


function formatTime(time) {

  if (isNaN(time)) return '0:00';

  const minutes =
  Math.floor(time / 60);

  const seconds =
  Math.floor(time % 60)
  .toString()
  .padStart(2, '0');

  return `${minutes}:${seconds}`;

}


searchInput.addEventListener(
  'input',
  (e) => {

    const term =
    e.target.value.toLowerCase();


    filteredSongs =
    songs.filter(song => {

      return (
        song.title.toLowerCase()
        .includes(term)
        ||
        song.artist.toLowerCase()
        .includes(term)
      );

    });


    renderPlaylist();

  }
);


loadSongs();
