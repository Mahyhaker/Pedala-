// State and Configuration
const STATE = {
    ccurrentUser: null,
    map: null,
    bikeMarkers: [],
    userLocation: null,
    scheduledRides: []
};

const CONFIG = {
    initialPoints: 100,
    pointsPerRental: 10,
    mapCenter: { lat: -23.5505, lon: -46.6333 },
    bikeRadius: 0.01 // Approximately 1km
};
const RideService = {
    scheduleRide(latitude, longitude, dateTime) {
        if (!STATE.currentUser) throw new Error('Usuário não logado');
        
        const ride = {
            id: Date.now(),
            latitude,
            longitude,
            dateTime: new Date(dateTime).toISOString(),
            userId: STATE.currentUser.email
        };

        STATE.scheduledRides.push(ride);
        this.saveRides();
        return ride;
    },

    getRidesForUser() {
        return STATE.scheduledRides.filter(ride => ride.userId === STATE.currentUser.email);
    },

    deleteRide(rideId) {
        const index = STATE.scheduledRides.findIndex(ride => ride.id === rideId);
        if (index > -1) {
            STATE.scheduledRides.splice(index, 1);
            this.saveRides();
        }
    },

    saveRides() {
        localStorage.setItem('scheduledRides', JSON.stringify(STATE.scheduledRides));
    },

    loadRides() {
        const savedRides = localStorage.getItem('scheduledRides');
        if (savedRides) {
            STATE.scheduledRides = JSON.parse(savedRides);
        }
    },

    getCountdown(dateTime) {
        const now = new Date();
        const rideDate = new Date(dateTime);
        const diff = rideDate - now;
        
        if (diff < 0) return 'Passeio já aconteceu';
        
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        
        return `${days} dias e ${hours} horas`;
    }
};

// Services
// Modify BikeService to add location and availability constraints
const BikeService = {
    generateRandomBikes(centerLat, centerLon, count = 10) {
        const bikes = [];
        for (let i = 0; i < count; i++) {
            const randomLat = centerLat + (Math.random() - 0.5) * CONFIG.bikeRadius / 2;
            const randomLon = centerLon + (Math.random() - 0.5) * CONFIG.bikeRadius / 2;
            bikes.push({
                id: i + 1,
                name: `Bike ${i + 1}`,
                type: ['Mountain Bike', 'City Bike', 'Electric Bike'][Math.floor(Math.random() * 3)],
                latitude: randomLat,
                longitude: randomLon,
                available: true,
                currentRental: null
            });
        }
        return bikes;
    },

    // Calculate distance between two points using Haversine formula
    calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371; // Earth's radius in kilometers
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = 
            Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
            Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c * 1000; // Convert to meters
    },

    getNearbyBikes(userLat, userLon) {
        return this.generateRandomBikes(userLat, userLon);
    },

    rentBike(bikeId) {
        if (!STATE.currentUser) throw new Error('Usuário não logado');
        
        // Check if user has an active rental
        if (STATE.currentUser.rentals.some(rental => !rental.endTime)) {
            throw new Error('Você já tem uma bicicleta alugada. Primeiro faça a devolução.');
        }

        // Find the bike and check its availability and proximity
        const nearbyBikes = this.getNearbyBikes(STATE.userLocation.latitude, STATE.userLocation.longitude);
        const bike = nearbyBikes.find(b => b.id === bikeId);

        if (!bike) {
            throw new Error('Bicicleta não encontrada');
        }

        // Check if user is within 100 meters of the bike
        const distance = this.calculateDistance(
            STATE.userLocation.latitude, 
            STATE.userLocation.longitude,
            bike.latitude, 
            bike.longitude
        );

        
        const rental = {
            bikeId,
            bikeName: `Bike ${bikeId}`,
            startTime: new Date().toISOString(),
            points: CONFIG.pointsPerRental,
            endTime: null
        };

        STATE.currentUser.rentals.push(rental);
        STATE.currentUser.points += CONFIG.pointsPerRental;
        
        const users = JSON.parse(localStorage.getItem('users') || '{}');
        users[STATE.currentUser.email] = STATE.currentUser;
        localStorage.setItem('users', JSON.stringify(users));

        return rental;
    },

    returnBike(rentalIndex) {
        if (!STATE.currentUser) throw new Error('Usuário não logado');
        
        const rental = STATE.currentUser.rentals[rentalIndex];
        if (!rental || rental.endTime) {
            throw new Error('Nenhum aluguel ativo encontrado');
        }

        rental.endTime = new Date().toISOString();

        const users = JSON.parse(localStorage.getItem('users') || '{}');
        users[STATE.currentUser.email] = STATE.currentUser;
        localStorage.setItem('users', JSON.stringify(users));

        return rental;
    }
};

// Update rentBikeById to use the new BikeService method
function rentBikeById(bikeId) {
    try {
        const rental = BikeService.rentBike(bikeId);
        Swal.fire({
            icon: 'success',
            title: 'Bicicleta Alugada',
            text: `Você ganhou ${rental.points} pontos! Devolva a bicicleta quando terminar.`
        });
        UI.updateUserInfo();
        UI.updateBikeList();
        UI.updateRentalHistory();
    } catch (error) {
        Swal.fire({ icon: 'error', title: 'Erro', text: error.message });
    }
}

// Add a new function to return a bike
function returnBike(rentalIndex) {
    try {
        const rental = BikeService.returnBike(rentalIndex);
        const rentalDurationMs = new Date(rental.endTime) - new Date(rental.startTime);
        const rentalDurationMinutes = Math.floor(rentalDurationMs / (1000 * 60));
        
        Swal.fire({
            icon: 'success',
            title: 'Bicicleta Devolvida',
            text: `Você alugou a bicicleta por ${rentalDurationMinutes} minutos. 
            O valor ja foi debitado do seu cartão de crédito.`
        });
        UI.updateUserInfo();
        UI.updateBikeList();
        UI.updateRentalHistory();
    } catch (error) {
        Swal.fire({ icon: 'error', title: 'Erro', text: error.message });
    }
}


const AuthService = {
    validateFields(data) {
        const { email, password, cpf, phone } = data;
        
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            throw new Error('E-mail inválido');
        }
        if (password && password.length < 8) {
            throw new Error('Senha deve ter no mínimo 8 caracteres');
        }
        if (cpf && !/^\d{11}$/.test(cpf.replace(/\D/g, ''))) {
            throw new Error('CPF inválido');
        }
        if (phone && !/^\d{10,11}$/.test(phone.replace(/\D/g, ''))) {
            throw new Error('Telefone inválido');
        }
    },

    register(data) {
        this.validateFields(data);
        const users = JSON.parse(localStorage.getItem('users') || '{}');
        
        if (users[data.email]) {
            throw new Error('E-mail já cadastrado');
        }

        const user = {
            ...data,
            points: CONFIG.initialPoints,
            rentals: []
        };
        users[data.email] = user;
        localStorage.setItem('users', JSON.stringify(users));
        return user;
    },

    login(email, password) {
        const users = JSON.parse(localStorage.getItem('users') || '{}');
        const user = users[email];

        if (!user || user.password !== password) {
            throw new Error('Credenciais inválidas');
        }

        return user;
    },

    updateProfile(data) {
        this.validateFields(data);
        const users = JSON.parse(localStorage.getItem('users') || '{}');
        const updatedUser = { ...STATE.currentUser, ...data };
        users[updatedUser.email] = updatedUser;
        localStorage.setItem('users', JSON.stringify(users));
        STATE.currentUser = updatedUser;
        return updatedUser;
    }
};

// UI Functions
const UI = {
    toggleContainers(showContainer) {
        ['login-container', 'register-container', 'dashboard-container', 'profile-container'].forEach(container => {
            document.getElementById(container).classList.toggle('hidden', container !== showContainer);
        });
    },

    updateUserInfo() {
        if (!STATE.currentUser) return;
        
        document.getElementById('user-name').textContent = STATE.currentUser.name;
        document.getElementById('user-points').textContent = `${STATE.currentUser.points} pontos`;
    },

    updateBikeList() {
        if (!STATE.userLocation) return;

        const nearbyBikes = BikeService.getNearbyBikes(
            STATE.userLocation.latitude,
            STATE.userLocation.longitude
        );

        document.getElementById('bike-list').innerHTML = nearbyBikes.map(bike => `
            <div class="bike-item card mb-2">
                <div class="card-body">
                    <h6 class="card-title">${bike.name}</h6>
                    <p class="card-text">${bike.type} - ${bike.available ? 'Available' : 'Unavailable'}</p>
                    <button class="btn btn-success" onclick="rentBikeById(${bike.id})">
                        Alugar (+${CONFIG.pointsPerRental} points)
                    </button>
                </div>
            </div>
        `).join('');
    },

    updateRentalHistory() {
        const rentals = STATE.currentUser.rentals || [];
        document.getElementById('rental-history').innerHTML = rentals.map((rental, index) => `
            <div class="rental-item card mb-2">
                <div class="card-body">
                    <h6 class="card-title">${rental.bikeName}</h6>
                    <p class="card-text">
                        Alugada em: ${new Date(rental.startTime).toLocaleString()}<br>
                        Pontos ganhos: +${rental.points}
                        ${!rental.endTime ? `<br><button class="btn btn-primary" onclick="returnBike(${index})">Devolver Bicicleta</button>` : ''}
                    </p>
                </div>
            </div>
        `).join('');
    },

    fillProfileForm() {
        if (!STATE.currentUser) return;
        
        ['name', 'email', 'phone', 'cpf', 'points'].forEach(field => {
            document.getElementById(`profile-${field}`).value = STATE.currentUser[field];
        });
    }
};

// Map Functions
function initMap(latitude, longitude) {
    if (STATE.map) STATE.map.remove();

    STATE.map = L.map('map').setView([latitude, longitude], 15);
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(STATE.map);

    // User marker
    L.marker([latitude, longitude], {
        icon: L.divIcon({
            className: 'user-location-marker',
            html: '<div class="user-marker"></div>'
        })
    }).addTo(STATE.map);

    // Bike markers
    const nearbyBikes = BikeService.getNearbyBikes(latitude, longitude);
    STATE.bikeMarkers = nearbyBikes.map(bike => {
        return L.marker([bike.latitude, bike.longitude], {
            icon: L.divIcon({
                className: 'bike-location-marker',
                html: `<div class="bike-marker">${bike.name}</div>`
            })
        })
        .bindPopup(`
            <div class="bike-popup">
                <strong>${bike.name}</strong>
                <p>${bike.type}</p>
                <button class="btn btn-success btn-sm" onclick="rentBikeById(${bike.id})">
                    Alugar (+${CONFIG.pointsPerRental} pontos)
                </button>
            </div>
        `)
        .addTo(STATE.map);
    });
    STATE.map.on('click', function(e) {
        if (!STATE.currentUser) return;
        
        Swal.fire({
            title: 'Agendar Passeio',
            html: `
                <div class="form-group">
                    <label for="ride-datetime">Data e Hora do Passeio</label>
                    <input type="datetime-local" id="ride-datetime" class="form-control" min="${new Date().toISOString().slice(0, 16)}">
                </div>
            `,
            showCancelButton: true,
            confirmButtonText: 'Agendar',
            cancelButtonText: 'Cancelar',
            preConfirm: () => {
                const dateTime = document.getElementById('ride-datetime').value;
                if (!dateTime) {
                    Swal.showValidationMessage('Por favor, selecione a data e hora');
                    return false;
                }
                return dateTime;
            }
        }).then((result) => {
            if (result.isConfirmed) {
                try {
                    const ride = RideService.scheduleRide(e.latlng.lat, e.latlng.lng, result.value);
                    addRideMarker(ride);
                    updateScheduledRidesList();
                    Swal.fire('Sucesso', 'Passeio agendado com sucesso!', 'success');
                } catch (error) {
                    Swal.fire('Erro', error.message, 'error');
                }
            }
        });
    });
}

// Add function to create ride markers
function addRideMarker(ride) {
    const marker = L.marker([ride.latitude, ride.longitude], {
        icon: L.divIcon({
            className: 'scheduled-ride-marker',
            html: `<div class="ride-marker">📅 ${new Date(ride.dateTime).toLocaleDateString()}</div>`
        })
    })
    .bindPopup(`
        <div class="ride-popup">
            <strong>Passeio Agendado</strong>
            <p>Data: ${new Date(ride.dateTime).toLocaleString()}</p>
            <p>Contagem: ${RideService.getCountdown(ride.dateTime)}</p>
            <button class="btn btn-danger btn-sm" onclick="deleteRide(${ride.id})">
                Cancelar Passeio
            </button>
        </div>
    `)
    .addTo(STATE.map);

    return marker;
}

// Add function to delete rides
function deleteRide(rideId) {
    Swal.fire({
        title: 'Cancelar Passeio',
        text: 'Tem certeza que deseja cancelar este passeio?',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Sim',
        cancelButtonText: 'Não'
    }).then((result) => {
        if (result.isConfirmed) {
            RideService.deleteRide(rideId);
            updateScheduledRidesList();
            STATE.map.eachLayer((layer) => {
                if (layer instanceof L.Marker) {
                    layer.remove();
                }
            });
            initMap(STATE.userLocation.latitude, STATE.userLocation.longitude);
            Swal.fire('Sucesso', 'Passeio cancelado com sucesso!', 'success');
        }
    });
}

// Add function to update scheduled rides list
function updateScheduledRidesList() {
    const rides = RideService.getRidesForUser();
    const ridesList = document.getElementById('scheduled-rides-list');
    
    ridesList.innerHTML = rides.map(ride => `
        <div class="ride-item card mb-2">
            <div class="card-body">
                <h6 class="card-title">Passeio Agendado</h6>
                <p class="card-text">
                    Data: ${new Date(ride.dateTime).toLocaleString()}<br>
                    Faltam: ${RideService.getCountdown(ride.dateTime)}
                </p>
                <button class="btn btn-danger btn-sm" onclick="deleteRide(${ride.id})">
                    Cancelar Passeio
                </button>
            </div>
        </div>
    `).join('');
}

// Event Handlers
function setupEventListeners() {
    // Auth Navigation
    RideService.loadRides();
    document.getElementById('ranking-btn').addEventListener('click', toggleRanking);
    
    document.getElementById('register-link').addEventListener('click', e => {
        e.preventDefault();
        UI.toggleContainers('register-container');
    });

    document.getElementById('login-link').addEventListener('click', e => {
        e.preventDefault();
        UI.toggleContainers('login-container');
    });

    // Profile Navigation
    document.getElementById('profile-link').addEventListener('click', e => {
        e.preventDefault();
        UI.toggleContainers('profile-container');
        UI.fillProfileForm();
    });

    document.getElementById('back-to-dashboard').addEventListener('click', () => {
        UI.toggleContainers('dashboard-container');
    });

    // Forms
    document.getElementById('register-form').addEventListener('submit', handleRegister);
    document.getElementById('login-form').addEventListener('submit', handleLogin);
    document.getElementById('profile-form').addEventListener('submit', handleProfileUpdate);
    document.getElementById('logout-btn').addEventListener('click', handleLogout);
}

async function handleRegister(e) {
    e.preventDefault();
    const formData = {
        name: document.getElementById('register-name').value,
        email: document.getElementById('register-email').value,
        password: document.getElementById('register-password').value,
        confirmPassword: document.getElementById('confirm-password').value,
        phone: document.getElementById('register-phone').value,
        cpf: document.getElementById('register-cpf').value
    };

    try {
        if (formData.password !== formData.confirmPassword) {
            throw new Error('Senhas não coincidem');
        }

        await AuthService.register(formData);
        Swal.fire({
            icon: 'success',
            title: 'Registro Realizado',
            text: 'Sua conta foi criada com sucesso!'
        });
        UI.toggleContainers('login-container');
    } catch (error) {
        Swal.fire({ icon: 'error', title: 'Erro', text: error.message });
    }
}

async function handleLogin(e) {
    e.preventDefault();
    try {
        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-password').value;
        STATE.currentUser = await AuthService.login(email, password);
        UI.toggleContainers('dashboard-container');
        getUserLocation();
        UI.updateUserInfo();
        UI.updateRentalHistory();
    } catch (error) {
        Swal.fire({ icon: 'error', title: 'Erro', text: error.message });
    }
}

async function handleProfileUpdate(e) {
    e.preventDefault();
    try {
        const updatedData = {
            phone: document.getElementById('profile-phone').value
        };
        
        await AuthService.updateProfile(updatedData);
        Swal.fire({
            icon: 'success',
            title: 'Perfil Atualizado',
            text: 'Suas informações foram atualizadas com sucesso!'
        });
        UI.toggleContainers('dashboard-container');
        UI.updateUserInfo();
    } catch (error) {
        Swal.fire({ icon: 'error', title: 'Erro', text: error.message });
    }
}

function handleLogout() {
    Swal.fire({
        title: 'Deseja sair?',
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: 'Sim',
        cancelButtonText: 'Não'
    }).then((result) => {
        if (result.isConfirmed) {
            STATE.currentUser = null;
            STATE.userLocation = null;
            UI.toggleContainers('login-container');
        }
    });
}

// Location Functions
function getUserLocation() {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            position => {
                STATE.userLocation = {
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude
                };
                initMap(STATE.userLocation.latitude, STATE.userLocation.longitude);
                UI.updateBikeList();
            },
            error => {
                console.error('Geolocation error:', error);
                useDefaultLocation();
            }
        );
    } else {
        useDefaultLocation();
    }
}

function clearUserCache() {
    // Show a confirmation dialog before clearing
    Swal.fire({
        title: 'Limpar Dados de Usuário',
        text: 'Tem certeza que deseja limpar todos os dados de usuário? Esta ação não pode ser desfeita.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        cancelButtonColor: '#3085d6',
        confirmButtonText: 'Sim, limpar tudo',
        cancelButtonText: 'Cancelar'
    }).then((result) => {
        if (result.isConfirmed) {
            // Clear localStorage
            localStorage.removeItem('users');
            
            // Reset STATE
            STATE.currentUser = null;
            STATE.userLocation = null;
            
            // Show success message
            Swal.fire({
                icon: 'success',
                title: 'Dados Limpos',
                text: 'Todos os dados de usuário foram removidos com sucesso.'
            });
            
            // Ensure user is returned to login screen
            UI.toggleContainers('login-container');
        }
    });
    // Add this to the existing script.js file

const RankingService = {
    // Average bike speed (km/h) - typical urban bicycle speed
    AVERAGE_BIKE_SPEED: 15,

    calculateUserDistance(user) {
        // Calculate total distance based on rental times
        const totalDistance = user.rentals.reduce((total, rental) => {
            if (rental.startTime && rental.endTime) {
                // Calculate rental duration in hours
                const startTime = new Date(rental.startTime);
                const endTime = new Date(rental.endTime);
                const durationHours = (endTime - startTime) / (1000 * 60 * 60);

                // Convert time to distance
                const distance = durationHours * this.AVERAGE_BIKE_SPEED;
                return total + distance;
            }
            return total;
        }, 0);

        return Math.round(totalDistance * 10) / 10; // Round to 1 decimal place
    },

    generateUserRanking() {
        // Retrieve users from localStorage
        const users = JSON.parse(localStorage.getItem('users') || '{}');
        
        // Convert users to array and calculate distances
        const userRankings = Object.values(users)
            .map(user => ({
                name: user.name,
                email: user.email,
                totalDistance: this.calculateUserDistance(user),
                totalRentals: user.rentals.filter(rental => rental.endTime).length
            }))
            // Sort by total distance in descending order
            .sort((a, b) => b.totalDistance - a.totalDistance);

        return userRankings;
    },

    displayRanking() {
        const rankings = this.generateUserRanking();
        
        // Create ranking container if it doesn't exist
        const rankingContainer = document.querySelector('#user-ranking-container');
        if (!rankingContainer) {
            rankingContainer = document.createElement('div');
            rankingContainer.id = 'user-ranking-container';
            rankingContainer.className = 'card mt-3';
            rankingContainer.innerHTML = `
                <div class="card-body">
                    <h5 class="card-title">Ranking de Usuários</h5>
                    <div id="ranking-list"></div>
                </div>
            `;
            document.querySelector('.container').appendChild(rankingContainer);
        }

        const rankingList = document.getElementById('ranking-list');
        rankingList.innerHTML = rankings.map((user, index) => `
            <div class="ranking-item">
                <span class="ranking-position">${index + 1}º</span>
                <span class="ranking-name">${user.name}</span>
                <span class="ranking-distance">${user.totalDistance} km</span>
                <span class="ranking-rentals">(${user.totalRentals} aluguéis)</span>
            </div>
        `).join('');
    }
};

// Add a method to show ranking in the dashboard
function showUserRanking() {
    RankingService.displayRanking();
}

// You can add this to your existing event listeners or create a new button
// document.getElementById('ranking-btn').addEventListener('click', showUserRanking);
}
function useDefaultLocation() {
    Swal.fire({
        icon: 'info',
        title: 'Localização Padrão',
        text: 'Usando localização padrão em São Paulo'
    });
    STATE.userLocation = {
        latitude: CONFIG.mapCenter.lat,
        longitude: CONFIG.mapCenter.lon
    };
    initMap(STATE.userLocation.latitude, STATE.userLocation.longitude);
    UI.updateBikeList();
}

// Global Functions
function rentBikeById(bikeId) {
    try {
        const rental = BikeService.rentBike(bikeId);
        Swal.fire({
            icon: 'success',
            title: 'Bicicleta Alugada',
            text: `Você ganhou ${rental.points} pontos!`
        });
        UI.updateUserInfo();
        UI.updateBikeList();
        UI.updateRentalHistory();
    } catch (error) {
        Swal.fire({ icon: 'error', title: 'Erro', text: error.message });
    }
}
const RankingService = {
    // Average bike speed (km/h) - typical urban bicycle speed
    AVERAGE_BIKE_SPEED: 15,

    calculateUserDistance(user) {
        const totalDistance = user.rentals.reduce((total, rental) => {
            if (rental.startTime && rental.endTime) {
                const startTime = new Date(rental.startTime);
                const endTime = new Date(rental.endTime);
                const durationHours = (endTime - startTime) / (1000 * 60 * 60);
                const distance = durationHours * this.AVERAGE_BIKE_SPEED;
                return total + distance;
            }
            return total;
        }, 0);

        return Math.round(totalDistance * 10) / 10;
    },

    generateUserRanking() {
        const users = JSON.parse(localStorage.getItem('users') || '{}');
        return Object.values(users)
            .map(user => ({
                name: user.name,
                email: user.email,
                points: user.points || 0,
                totalRentals: user.rentals ? user.rentals.length : 0,
                totalDistance: this.calculateUserDistance(user)
            }))
            .sort((a, b) => b.points - a.points);
    },

    displayRanking() {
        const rankings = this.generateUserRanking();
        const rankingContainer = document.getElementById('ranking-container');
        
        if (!rankings.length) {
            rankingContainer.innerHTML = '<p class="text-center text-gray-500">Nenhum usuário no ranking.</p>';
            return;
        }

        rankingContainer.innerHTML = `
            <div class="bg-white rounded-lg shadow p-4">
                <h5 class="text-xl font-semibold mb-4">Ranking de Usuários</h5>
                <div class="overflow-x-auto">
                    <table class="w-full">
                        <thead>
                            <tr class="bg-gray-50">
                                <th class="px-4 py-2 text-left">Posição</th>
                                <th class="px-4 py-2 text-left">Nome</th>
                                <th class="px-4 py-2 text-right">Pontos</th>
                                <th class="px-4 py-2 text-right">Distância</th>
                                <th class="px-4 py-2 text-right">Aluguéis</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rankings.map((user, index) => `
                                <tr class="${index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}">
                                    <td class="px-4 py-2">${index + 1}º</td>
                                    <td class="px-4 py-2">${user.name}</td>
                                    <td class="px-4 py-2 text-right">${user.points}</td>
                                    <td class="px-4 py-2 text-right">${user.totalDistance} km</td>
                                    <td class="px-4 py-2 text-right">${user.totalRentals}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }
};


// Função para alternar a visibilidade do ranking
function toggleRanking() {
    const rankingContainer = document.getElementById('ranking-container');
    const isHidden = rankingContainer.classList.contains('hidden');
    
    if (isHidden) {
        RankingService.displayRanking();
        rankingContainer.classList.remove('hidden');
    } else {
        rankingContainer.classList.add('hidden');
    }
}


// Initialize Application
document.addEventListener('DOMContentLoaded', setupEventListeners);
