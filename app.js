const audio = document.getElementById('audio');
const playBtn = document.getElementById('play');
const nextBtn = document.getElementById('next');
const prevBtn = document.getElementById('prev');
const title = document.getElementById('title');
const artist = document.getElementById('artist');
const cover = document.getElementById('cover');
const playlistEl = document.getElementById('playlist');
const statusText = document.getElementById('status');
const searchInput = document.getElementById('search');
const addBtn = document.getElementById('add-btn');

let songs = [];
let filteredSongs = [];
let current = 0;

async function loadSongs() {
    statusText.textContent = 'Carregando playlist...';
    
    const localData = localStorage.getItem('myPlaylist');
    if (localData) {
        songs = JSON.parse(localData);
    } else {
        const response = await fetch('music.json');
        songs = await response.json();
        localStorage.setItem('myPlaylist', JSON.stringify(songs));
    }
    
    filteredSongs = songs;
    renderPlaylist();
    if (songs.length > 0) loadSong(0);
    statusText.textContent = 'Playlist carregada';
}

function saveToStorage() {
    localStorage.setItem('myPlaylist', JSON.stringify(songs));
}

function addSong() {
    const t = document.getElementById('new-title').value;
    const a = document.getElementById('new-artist').value;
    const c = document.getElementById('new-cover').value;
    const u = document.getElementById('new-url').value;

    if (t && u) {
        songs.push({ title: t, artist: a, cover: c, url: u });
        saveToStorage();
        filteredSongs = songs;
        renderPlaylist();
        alert('Música adicionada!');
    }
}

addBtn.onclick = addSong;

function loadSong(index) {
    const song = songs[index];
    if (!song) return;
    audio.src = song.url;
    title.textContent = song.title;
    artist.textContent = song.artist;
    cover.src = song.cover;
}

function renderPlaylist() {
    playlistEl.innerHTML = '';
    filteredSongs.forEach((song, index) => {
        const li = document.createElement('li');
        li.innerHTML = `<strong>${song.title}</strong><br>${song.artist}`;
        li.onclick = () => {
            current = index;
            loadSong(current);
            audio.play();
        };
        playlistEl.appendChild(li);
    });
}

// Controles Básicos
playBtn.onclick = () => audio.paused ? audio.play() : audio.pause();
nextBtn.onclick = () => { current = (current + 1) % songs.length; loadSong(current); audio.play(); };
prevBtn.onclick = () => { current = (current - 1 + songs.length) % songs.length; loadSong(current); audio.play(); };

audio.onplay = () => playBtn.textContent = '⏸';
audio.onpause = () => playBtn.textContent = '▶';

loadSongs();
