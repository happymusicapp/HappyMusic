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

// Inicialização
async function loadSongs() {
    statusText.textContent = 'Carregando playlist...';
    
    const localData = localStorage.getItem('myPlaylist');
    if (localData) {
        songs = JSON.parse(localData);
    } else {
        try {
            const response = await fetch('music.json');
            songs = await response.json();
            saveToStorage();
        } catch (error) {
            console.error(error);
            statusText.textContent = 'Erro ao carregar arquivo inicial';
            return;
        }
    }
    
    filteredSongs = songs;
    renderPlaylist();
    if (songs.length > 0) {
        loadSong(0);
        statusText.textContent = 'Playlist carregada';
    }
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
        
        // Limpar inputs
        document.getElementById('new-title').value = '';
        document.getElementById('new-artist').value = '';
        document.getElementById('new-cover').value = '';
        document.getElementById('new-url').value = '';
        alert('Música adicionada com sucesso!');
    } else {
        alert('Por favor, preencha pelo menos o Título e a URL do Áudio.');
    }
}

addBtn.onclick = addSong;

function loadSong(index) {
    const song = songs[index];
    if (!song) return;
    
    current = index;
    audio.src = song.url;
    title.textContent = song.title;
    artist.textContent = song.artist;
    cover.src = song.cover || 'https://i.imgur.com/8Km9tLL.jpg';
    statusText.textContent = 'Pronto para tocar';
}

function renderPlaylist() {
    playlistEl.innerHTML = '';
    filteredSongs.forEach((song, index) => {
        const li = document.createElement('li');
        li.style.display = 'flex';
        li.style.justifyContent = 'space-between';
        li.style.alignItems = 'center';

        li.innerHTML = `
            <div style="cursor: pointer; flex-grow: 1;">
                <strong>${song.title}</strong><br>${song.artist}
            </div>
            <button class="delete-btn" style="width: 30px; height: 30px; font-size: 14px; background: #ff4d4d; color: white; border: none; border-radius: 5px; cursor: pointer; margin-left: 10px;">🗑</button>
        `;

        li.querySelector('div').onclick = () => {
            const originalIndex = songs.indexOf(song);
            loadSong(originalIndex);
            audio.play();
        };

        li.querySelector('.delete-btn').onclick = (e) => {
            e.stopPropagation();
            if (confirm(`Remover "${song.title}" da playlist?`)) {
                songs = songs.filter(s => s !== song);
                saveToStorage();
                filteredSongs = songs;
                renderPlaylist();
            }
        };

        playlistEl.appendChild(li);
    });
}

// Controles
playBtn.onclick = () => {
    if (audio.paused) {
        audio.play();
    } else {
        audio.pause();
    }
};

nextBtn.onclick = () => {
    current = (current + 1) % songs.length;
    loadSong(current);
    audio.play();
};

prevBtn.onclick = () => {
    current = (current - 1 + songs.length) % songs.length;
    loadSong(current);
    audio.play();
};

// Eventos de Áudio
audio.onplay = () => playBtn.textContent = '⏸';
audio.onpause = () => playBtn.textContent = '▶';
audio.onended = () => nextBtn.click();
audio.onerror = () => statusText.textContent = 'Erro: Verifique o link do áudio';

// Busca
searchInput.addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase();
    filteredSongs = songs.filter(song => 
        song.title.toLowerCase().includes(term) || 
        song.artist.toLowerCase().includes(term)
    );
    renderPlaylist();
});

loadSongs();
