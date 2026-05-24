const audio =
document.getElementById('audio');

const playBtn =
document.getElementById('play');

const nextBtn =
document.getElementById('next');

const prevBtn =
document.getElementById('prev');

const title =
document.getElementById('title');

const artist =
document.getElementById('artist');

const cover =
document.getElementById('cover');

const playlistEl =
document.getElementById('playlist');

let songs = [];

let current = 0;

async function loadSongs() {

  const response =
  await fetch('music.json');

  songs = await response.json();

  renderPlaylist();

  loadSong(current);

}

function loadSong(index) {

  const song = songs[index];

audio.pause();

audio.src = song.url;

audio.load();

title.textContent = song.title;

artist.textContent = song.artist;

cover.src = song.cover;

}

function renderPlaylist() {

  playlistEl.innerHTML = '';

  songs.forEach((song, index) => {

    const li =
    document.createElement('li');

    li.innerHTML = `
      <strong>${song.title}</strong>
      <br>
      ${song.artist}
    `;

    li.onclick = () => {

      current = index;

      loadSong(current);

      audio.play();

      playBtn.textContent = '⏸';

    };

    playlistEl.appendChild(li);

  });

}

playBtn.onclick = () => {

  if (audio.paused) {

    audio.play();

    playBtn.textContent = '⏸';

  } else {

    audio.pause();

    playBtn.textContent = '▶';

  }

};

nextBtn.onclick = () => {

  current =
  (current + 1) % songs.length;

  loadSong(current);

  audio.play();

};

prevBtn.onclick = () => {

  current =
  (current - 1 + songs.length)
  % songs.length;

  loadSong(current);

  audio.play();

};

audio.addEventListener(
  'ended',
  () => {

    nextBtn.click();

  }
);

loadSongs();
