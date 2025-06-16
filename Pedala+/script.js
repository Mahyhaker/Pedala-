// State and Configuration
const STATE = {
    currentUser: null,
    map: null,
    bikeMarkers: [],
    userLocation: null,
    scheduledRides: [],
    apiBaseUrl: 'http://localhost:5000' // URL base da API Flask
};

const CONFIG = {
    initialPoints: 100,
    pointsPerRental: 10,
    mapCenter: { lat: -23.5505, lon: -46.6333 },
    bikeRadius: 0.01, // Approximately 1km
    
    // Novo sistema de pontos e pagamento
    pointLevels: {
        bronze: { min: 0, max: 199, discount: 0 },
        silver: { min: 200, max: 499, discount: 0.10 },
        gold: { min: 500, max: Infinity, discount: 0.20 }
    },
    
    // Preços por minuto baseados no tipo de bicicleta
    pricing: {
        'Mountain Bike': 0.25, // R$ 0,25 por minuto (R$ 15 por hora)
        'City Bike': 0.20,     // R$ 0,20 por minuto (R$ 12 por hora)
        'Electric Bike': 0.40  // R$ 0,40 por minuto (R$ 24 por hora)
    }
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
const PointsService = {
    getUserLevel(points) {
        if (points >= CONFIG.pointLevels.gold.min) {
            return 'gold';
        } else if (points >= CONFIG.pointLevels.silver.min) {
            return 'silver';
        } else {
            return 'bronze';
        }
    },
    
    getDiscountRate(points) {
        const level = this.getUserLevel(points);
        return CONFIG.pointLevels[level].discount;
    },
    
    calculateRentalPoints(durationMinutes, bikeType) {
        // Base points from config
        let points = CONFIG.pointsPerRental;
        
        // Bonus points for longer rides
        if (durationMinutes > 60) {
            points += Math.floor(durationMinutes / 30) * 5; // 5 extra points per 30 minutes after the first hour
        }
        
        // Bonus points for premium bikes
        if (bikeType === 'Electric Bike') {
            points += 5;
        }
        
        return points;
    },
    
    calculateRentalCost(durationMinutes, bikeType, userPoints) {
        const pricePerMinute = CONFIG.pricing[bikeType] || CONFIG.pricing['City Bike']; // Default to City Bike price
        const basePrice = durationMinutes * pricePerMinute;
        
        // Apply discount based on user level
        const discountRate = this.getDiscountRate(userPoints);
        const finalPrice = basePrice * (1 - discountRate);
        
        return {
            basePrice: parseFloat(basePrice.toFixed(2)),
            discount: parseFloat((basePrice * discountRate).toFixed(2)),
            finalPrice: parseFloat(finalPrice.toFixed(2)),
            discountPercentage: discountRate * 100
        };
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
            bikeType: bike.type, // Armazenar o tipo da bicicleta para cálculos futuros
            startTime: new Date().toISOString(),
            points: CONFIG.pointsPerRental,
            endTime: null
        };
    
        STATE.currentUser.rentals.push(rental);
        
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
        
        // Calcular pontos e custo
        const earnedPoints = PointsService.calculateRentalPoints(rentalDurationMinutes, rental.bikeType);
        const cost = PointsService.calculateRentalCost(rentalDurationMinutes, rental.bikeType, STATE.currentUser.points);
        
        // Atualizar os pontos do usuário
        STATE.currentUser.points += earnedPoints;
        
        // Atualizar o registro de aluguel com os novos dados
        rental.points = earnedPoints;
        rental.cost = cost.finalPrice;
        
        // Salvar os dados atualizados
        const users = JSON.parse(localStorage.getItem('users') || '{}');
        users[STATE.currentUser.email] = STATE.currentUser;
        localStorage.setItem('users', JSON.stringify(users));
        
        const userLevel = PointsService.getUserLevel(STATE.currentUser.points);
        
        Swal.fire({
            icon: 'success',
            title: 'Bicicleta Devolvida',
            html: `
                <div class="rental-summary">
                    <p>Duração: ${rentalDurationMinutes} minutos</p>
                    <p>Pontos ganhos: +${earnedPoints}</p>
                    <p>Nível atual: ${userLevel.toUpperCase()}</p>
                    <p>Valor base: R$ ${cost.basePrice.toFixed(2)}</p>
                    <p>Desconto (${cost.discountPercentage}%): R$ ${cost.discount.toFixed(2)}</p>
                    <p><strong>Valor final: R$ ${cost.finalPrice.toFixed(2)}</strong></p>
                </div>
            `
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
        
        const userLevel = PointsService.getUserLevel(STATE.currentUser.points);
        const levelBadge = {
            'bronze': '🥉',
            'silver': '🥈',
            'gold': '🥇'
        }[userLevel];
        
        document.getElementById('user-name').textContent = STATE.currentUser.name;
        document.getElementById('user-points').textContent = `${STATE.currentUser.points} pontos`;
        document.getElementById('user-points').innerHTML = 
            `${STATE.currentUser.points} pontos <span class="level-badge ${userLevel}">${levelBadge} ${userLevel.toUpperCase()}</span>`;
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
        document.getElementById('rental-history').innerHTML = rentals.map((rental, index) => {
            let rentalInfo = `
                <div class="rental-item card mb-2">
                    <div class="card-body">
                        <h6 class="card-title">${rental.bikeName} (${rental.bikeType || 'City Bike'})</h6>
                        <p class="card-text">
                            Alugada em: ${new Date(rental.startTime).toLocaleString()}<br>
                            Pontos ganhos: +${rental.points}
            `;
            
            if (rental.endTime) {
                const durationMs = new Date(rental.endTime) - new Date(rental.startTime);
                const durationMinutes = Math.floor(durationMs / (1000 * 60));
                rentalInfo += `<br>Duração: ${durationMinutes} minutos`;
                
                if (rental.cost) {
                    rentalInfo += `<br>Valor pago: R$ ${rental.cost.toFixed(2)}`;
                }
            } else {
                rentalInfo += `<br><button class="btn btn-primary" onclick="returnBike(${index})">Devolver Bicicleta</button>`;
            }
            
            rentalInfo += `
                        </p>
                    </div>
                </div>
            `;
            
            return rentalInfo;
        }).join('');
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
    document.getElementById('export-powerbi-btn').addEventListener('click', () => {
        Swal.fire({
            title: 'Exportar Dados',
            text: 'Como você gostaria de exportar os dados?',
            icon: 'question',
            showCancelButton: true,
            confirmButtonText: 'API',
            cancelButtonText: 'Dados Locais',
            showCloseButton: true,
            footer: '<small>Escolha "API" para dados do servidor ou "Dados Locais" para dados salvos no navegador.</small>'
        }).then((result) => {
            if (result.isConfirmed) {
                // Usar a API
                exportDataForPowerBI();
            } else if (result.dismiss === Swal.DismissReason.cancel) {
                // Usar dados locais
                exportLocalDataForPowerBI();
            }
        });
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
function exportDataForPowerBI() {
    if (!STATE.currentUser) {
        Swal.fire({
            icon: 'error',
            title: 'Erro',
            text: 'Você precisa estar logado para exportar dados.'
        });
        return;
    }
    
    // Mostrar mensagem de carregamento
    Swal.fire({
        title: 'Exportando dados...',
        text: 'Por favor, aguarde enquanto preparamos os dados.',
        allowOutsideClick: false,
        didOpen: () => {
            Swal.showLoading();
        }
    });
    
    // Obter o token JWT do usuário atual (simulação)
    const token = localStorage.getItem('token');
    
    // Fazer a requisição para o endpoint de exportação
    fetch(`${STATE.apiBaseUrl}/api/export/powerbi`, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        }
    })
    .then(response => {
        if (!response.ok) {
            throw new Error('Falha ao exportar dados');
        }
        return response.json();
    })
    .then(data => {
        // Converter dados para JSON string formatada
        const jsonData = JSON.stringify(data, null, 2);
        
        // Criar um Blob com os dados
        const blob = new Blob([jsonData], { type: 'application/json' });
        const url = window.URL.createObjectURL(blob);
        
        // Criar um link de download
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = 'pedala_plus_data.json';
        
        // Adicionar ao documento e clicar para download
        document.body.appendChild(a);
        a.click();
        
        // Limpar
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
        
        Swal.fire({
            icon: 'success',
            title: 'Dados Exportados',
            text: 'Os dados foram exportados com sucesso. Você pode importar este arquivo JSON no Power BI.'
        });
    })
    .catch(error => {
        console.error('Erro ao exportar dados:', error);
        Swal.fire({
            icon: 'error',
            title: 'Erro',
            text: 'Falha ao exportar dados. Por favor, tente novamente.'
        });
    });
}

// Função para exportar dados diretamente do localStorage (backup caso a API não esteja disponível)
function exportLocalDataForPowerBI() {
    if (!STATE.currentUser) {
        Swal.fire({
            icon: 'error',
            title: 'Erro',
            text: 'Você precisa estar logado para exportar dados.'
        });
        return;
    }
    
    try {
        // Obter usuários do localStorage
        const users = JSON.parse(localStorage.getItem('users') || '{}');
        
        // Formatar dados para export
        const userData = [];
        const rentalData = [];
        const bikeUsageData = [];
        const bikeTypeSummary = {};
        
        // Estruturas para rastrear uso
        const userBikeCounts = {};
        const userBikeTypes = {};
        
        Object.values(users).forEach(user => {
            const email = user.email;
            userBikeCounts[email] = 0;
            userBikeTypes[email] = {};
            
            // Dados do usuário
            userData.push({
                name: user.name,
                email: user.email,
                points: user.points || 0
            });
            
            // Dados de aluguéis
            if (user.rentals && user.rentals.length > 0) {
                user.rentals.forEach(rental => {
                    // Incrementar contagem de bikes usadas
                    userBikeCounts[email]++;
                    
                    // Registrar tipo de bicicleta
                    const bikeType = rental.bikeType || 'City Bike'; // Tipo padrão se não especificado
                    
                    // Rastrear uso do tipo de bicicleta por usuário
                    if (!userBikeTypes[email][bikeType]) {
                        userBikeTypes[email][bikeType] = 0;
                    }
                    userBikeTypes[email][bikeType]++;
                    
                    // Rastrear uso global por tipo
                    if (!bikeTypeSummary[bikeType]) {
                        bikeTypeSummary[bikeType] = 0;
                    }
                    bikeTypeSummary[bikeType]++;
                    
                    // Calcular duração se o aluguel foi finalizado
                    let durationMinutes = null;
                    let estimatedDistance = null;
                    
                    if (rental.startTime && rental.endTime) {
                        const startTime = new Date(rental.startTime);
                        const endTime = new Date(rental.endTime);
                        durationMinutes = (endTime - startTime) / (1000 * 60);
                        estimatedDistance = (durationMinutes / 60) * 15; // 15 km/h em média
                    }
                    
                    rentalData.push({
                        user_email: user.email,
                        user_name: user.name,
                        bike_id: rental.bikeId,
                        bike_name: rental.bikeName || `Bike ${rental.bikeId}`,
                        bike_type: bikeType,
                        start_time: rental.startTime,
                        end_time: rental.endTime,
                        duration_minutes: durationMinutes ? Math.round(durationMinutes) : null,
                        estimated_distance_km: estimatedDistance ? Math.round(estimatedDistance * 10) / 10 : null,
                        points_earned: rental.points
                    });
                });
            }
        });
        
        // Adicionar resumo de uso de bikes por usuário
        Object.entries(userBikeCounts).forEach(([email, count]) => {
            const user = Object.values(users).find(u => u.email === email);
            if (user) {
                // Encontrar o tipo de bike mais usado por este usuário
                let favoriteType = null;
                let maxCount = 0;
                Object.entries(userBikeTypes[email]).forEach(([bikeType, typeCount]) => {
                    if (typeCount > maxCount) {
                        maxCount = typeCount;
                        favoriteType = bikeType;
                    }
                });
                
                bikeUsageData.push({
                    user_email: email,
                    user_name: user.name,
                    total_bikes_used: count,
                    favorite_bike_type: favoriteType,
                    bike_type_breakdown: userBikeTypes[email]
                });
            }
        });
        
        // Converter resumo de tipos de bikes para uma lista
        const totalUsage = Object.values(bikeTypeSummary).reduce((sum, count) => sum + count, 0);
        const bikeTypeSummaryArray = Object.entries(bikeTypeSummary).map(([bikeType, count]) => ({
            bike_type: bikeType,
            total_usage: count,
            percentage: totalUsage > 0 ? (count / totalUsage) * 100 : 0
        }));
        
        // Estrutura de dados para exportação
        const exportData = {
            users: userData,
            rentals: rentalData,
            bike_usage: bikeUsageData,
            bike_type_summary: bikeTypeSummaryArray
        };
        
        // Converter para JSON formatado
        const jsonData = JSON.stringify(exportData, null, 2);
        
        // Criar Blob para download
        const blob = new Blob([jsonData], { type: 'application/json' });
        const url = window.URL.createObjectURL(blob);
        
        // Criar link para download
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = 'pedala_plus_local_data.json';
        
        // Adicionar ao documento e clicar para download
        document.body.appendChild(a);
        a.click();
        
        // Limpar
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
        
        Swal.fire({
            icon: 'success',
            title: 'Dados Exportados',
            text: 'Os dados foram exportados com sucesso do armazenamento local. Você pode importar este arquivo JSON no Power BI.'
        });
    } catch (error) {
        console.error('Erro ao exportar dados locais:', error);
        Swal.fire({
            icon: 'error',
            title: 'Erro',
            text: 'Falha ao exportar dados locais. Por favor, tente novamente.'
        });
    }
}


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
    document.head.insertAdjacentHTML('beforeend', `
        <style>
            .level-badge {
                display: inline-block;
                margin-left: 8px;
                padding: 2px 8px;
                border-radius: 12px;
                font-size: 0.85em;
                font-weight: bold;
            }
            .level-badge.bronze {
                background-color: #cd7f32;
                color: white;
            }
            .level-badge.silver {
                background-color: #c0c0c0;
                color: #333;
            }
            .level-badge.gold {
                background-color: #ffd700;
                color: #333;
            }
            .rental-summary {
                text-align: left;
                padding: 10px;
                background-color: #f8f9fa;
                border-radius: 8px;
            }
            .rental-summary p {
                margin: 5px 0;
            }
        </style>
    `);
}


// Initialize Application
document.addEventListener('DOMContentLoaded', setupEventListeners);
