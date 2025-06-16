from flask import Flask, request, jsonify
from flask_sqlalchemy import SQLAlchemy
from flask_cors import CORS
from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime
import jwt
from functools import wraps
import os
from geopy.distance import geodesic
import random

app = Flask(__name__)
CORS(app)

# Configuration
app.config['SECRET_KEY'] = 'your-secret-key'  # Change this in production
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///Pedala+.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db = SQLAlchemy(app)

# Models
class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False)
    password = db.Column(db.String(200), nullable=False)
    phone = db.Column(db.String(20))
    cpf = db.Column(db.String(11))
    points = db.Column(db.Integer, default=100)
    rentals = db.relationship('Rental', backref='user', lazy=True)
    scheduled_rides = db.relationship('ScheduledRide', backref='user', lazy=True)

class Bike(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    type = db.Column(db.String(50), nullable=False)
    latitude = db.Column(db.Float, nullable=False)
    longitude = db.Column(db.Float, nullable=False)
    available = db.Column(db.Boolean, default=True)
    rentals = db.relationship('Rental', backref='bike', lazy=True)

class Rental(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    bike_id = db.Column(db.Integer, db.ForeignKey('bike.id'), nullable=False)
    start_time = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    end_time = db.Column(db.DateTime)
    points = db.Column(db.Integer, default=10)
    cost = db.Column(db.Float) # Adicionar coluna para o custo

class ScheduledRide(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    latitude = db.Column(db.Float, nullable=False)
    longitude = db.Column(db.Float, nullable=False)
    date_time = db.Column(db.DateTime, nullable=False)

# Authentication decorator
def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = request.headers.get('Authorization')
        if not token:
            return jsonify({'message': 'Token is missing'}), 401
        try:
            token = token.split()[1]  # Remove 'Bearer ' prefix
            data = jwt.decode(token, app.config['SECRET_KEY'], algorithms=["HS256"])
            current_user = User.query.get(data['user_id'])
        except:
            return jsonify({'message': 'Invalid token'}), 401
        return f(current_user, *args, **kwargs)
    return decorated

# Routes
@app.route('/api/register', methods=['POST'])
def register():
    data = request.get_json()
    
    if User.query.filter_by(email=data['email']).first():
        return jsonify({'message': 'Email already registered'}), 400

    hashed_password = generate_password_hash(data['password'])
    new_user = User(
        name=data['name'],
        email=data['email'],
        password=hashed_password,
        phone=data.get('phone'),
        cpf=data.get('cpf')
    )
    
    db.session.add(new_user)
    db.session.commit()
    
    return jsonify({'message': 'User registered successfully'}), 201

@app.route('/api/login', methods=['POST'])
def login():
    data = request.get_json()
    user = User.query.filter_by(email=data['email']).first()
    
    if user and check_password_hash(user.password, data['password']):
        token = jwt.encode({
            'user_id': user.id,
            'exp': datetime.utcnow() + timedelta(days=1)
        }, app.config['SECRET_KEY'])
        
        return jsonify({
            'token': token,
            'user': {
                'name': user.name,
                'email': user.email,
                'points': user.points
            }
        })
    
    return jsonify({'message': 'Invalid credentials'}), 401

@app.route('/api/bikes/nearby', methods=['GET'])
@token_required
def get_nearby_bikes(current_user):
    user_lat = float(request.args.get('latitude'))
    user_lon = float(request.args.get('longitude'))
    
    bikes = Bike.query.filter_by(available=True).all()
    nearby_bikes = []
    
    for bike in bikes:
        distance = geodesic(
            (user_lat, user_lon),
            (bike.latitude, bike.longitude)
        ).meters
        
        if distance <= 1000:  # Within 1km
            nearby_bikes.append({
                'id': bike.id,
                'name': bike.name,
                'type': bike.type,
                'latitude': bike.latitude,
                'longitude': bike.longitude,
                'distance': round(distance)
            })
    
    return jsonify(nearby_bikes)

@app.route('/api/rentals/start', methods=['POST'])
@token_required
def start_rental(current_user):
    data = request.get_json()
    bike = Bike.query.get(data['bike_id'])
    
    if not bike or not bike.available:
        return jsonify({'message': 'Bike not available'}), 400
        
    # Check if user has active rental
    active_rental = Rental.query.filter_by(
        user_id=current_user.id,
        end_time=None
    ).first()
    
    if active_rental:
        return jsonify({'message': 'User has active rental'}), 400
    
    # Check distance
    user_location = (data['user_latitude'], data['user_longitude'])
    bike_location = (bike.latitude, bike.longitude)
    distance = geodesic(user_location, bike_location).meters
    
    if distance > 100:
        return jsonify({'message': 'Too far from bike'}), 400
    
    rental = Rental(user_id=current_user.id, bike_id=bike.id)
    bike.available = False
    
    db.session.add(rental)
    db.session.commit()
    
    return jsonify({
        'rental_id': rental.id,
        'bike_type': bike.type, # Retornar o tipo da bicicleta
        'points_earned': rental.points
    })

@app.route('/api/rentals/end/<int:rental_id>', methods=['POST'])
@token_required
def end_rental(current_user, rental_id):
    data = request.get_json()
    rental = Rental.query.get(rental_id)
    
    if not rental or rental.user_id != current_user.id:
        return jsonify({'message': 'Invalid rental'}), 400
    
    if rental.end_time:
        return jsonify({'message': 'Rental already ended'}), 400
    
    rental.end_time = datetime.utcnow()
    rental.bike.available = True
    
    # Atualizar pontos e custo
    rental.points = data.get('points', rental.points)
    rental.cost = data.get('cost', 0)
    current_user.points += rental.points
    
    db.session.commit()
    
    return jsonify({
        'message': 'Rental ended successfully',
        'points_earned': rental.points,
        'cost': rental.cost,
        'total_points': current_user.points
    })

@app.route('/api/rides/cancel/<int:ride_id>', methods=['DELETE'])
@token_required
def cancel_ride(current_user, ride_id):
    ride = ScheduledRide.query.get(ride_id)
    
    if not ride or ride.user_id != current_user.id:
        return jsonify({'message': 'Invalid ride'}), 400
    
    db.session.delete(ride)
    db.session.commit()
    
    return jsonify({'message': 'Ride cancelled successfully'})

@app.route('/api/profile', methods=['GET'])
@token_required
def get_profile(current_user):
    return jsonify({
        'name': current_user.name,
        'email': current_user.email,
        'phone': current_user.phone,
        'cpf': current_user.cpf,
        'points': current_user.points
    })
@app.route('/api/export/powerbi', methods=['GET'])
@token_required
def export_data_for_powerbi(current_user):
    # Verifica se o usuário tem permissão (aqui poderia verificar um papel de admin)
    # Para simplificar, vamos permitir que qualquer usuário autenticado exporte os dados
    
    # Obter todos os usuários e suas informações relevantes
    users = User.query.all()
    
    # Lista para armazenar os dados formatados
    user_data = []
    rental_data = []
    bike_usage_data = []
    bike_type_summary = []
    
    # Dicionários para rastrear o uso
    user_bike_counts = {}  # Armazena quantas bikes cada usuário usou
    user_bike_types = {}   # Armazena os tipos de bikes que cada usuário usou
    all_bike_types_usage = {}  # Contagem global por tipo de bike
    
    # Coletar dados dos usuários e aluguéis
    for user in users:
        # Inicializar contadores para este usuário
        user_id = user.id
        user_bike_counts[user_id] = 0
        user_bike_types[user_id] = {}
        
        # Dados básicos do usuário
        user_info = {
            'user_id': user_id,
            'name': user.name,
            'email': user.email,
            'points': user.points
        }
        user_data.append(user_info)
        
        # Dados de cada aluguel do usuário
        for rental in user.rentals:
            # Incrementar contagem de bicicletas usadas
            user_bike_counts[user_id] += 1
            
            # Obter tipo da bicicleta
            bike = Bike.query.get(rental.bike_id)
            bike_type = bike.type if bike else "Desconhecido"
            
            # Registrar uso do tipo de bicicleta
            if bike_type not in user_bike_types[user_id]:
                user_bike_types[user_id][bike_type] = 0
            user_bike_types[user_id][bike_type] += 1
            
            # Atualizar contagem global por tipo
            if bike_type not in all_bike_types_usage:
                all_bike_types_usage[bike_type] = 0
            all_bike_types_usage[bike_type] += 1
            
            # Calcular duração se o aluguel foi finalizado
            duration_minutes = None
            if rental.end_time:
                duration = rental.end_time - rental.start_time
                duration_minutes = duration.total_seconds() / 60
            
            # Estimar distância com base no tempo (15 km/h em média)
            estimated_distance_km = None
            if duration_minutes:
                estimated_distance_km = (duration_minutes / 60) * 15  # 15 km/h
            
            rental_info = {
                'rental_id': rental.id,
                'user_id': user.id,
                'user_name': user.name,
                'bike_id': rental.bike_id,
                'bike_type': bike_type,  # Adicionado tipo da bicicleta
                'start_time': rental.start_time.isoformat(),
                'end_time': rental.end_time.isoformat() if rental.end_time else None,
                'duration_minutes': round(duration_minutes) if duration_minutes else None,
                'estimated_distance_km': round(estimated_distance_km, 2) if estimated_distance_km else None,
                'points_earned': rental.points
            }
            rental_data.append(rental_info)
    
    # Adicionar resumo de uso de bikes por usuário
    for user_id, count in user_bike_counts.items():
        user = User.query.get(user_id)
        
        # Encontrar o tipo de bike mais usado por este usuário
        favorite_type = None
        max_count = 0
        for bike_type, type_count in user_bike_types[user_id].items():
            if type_count > max_count:
                max_count = type_count
                favorite_type = bike_type
        
        bike_usage = {
            'user_id': user_id,
            'user_name': user.name,
            'total_bikes_used': count,
            'favorite_bike_type': favorite_type,
            'bike_type_breakdown': user_bike_types[user_id]
        }
        bike_usage_data.append(bike_usage)
    
    # Adicionar resumo geral de tipos de bike
    for bike_type, count in all_bike_types_usage.items():
        bike_type_summary.append({
            'bike_type': bike_type,
            'total_usage': count,
            'percentage': (count / sum(all_bike_types_usage.values())) * 100
        })
    
    # Estrutura dos dados para exportação
    export_data = {
        'users': user_data,
        'rentals': rental_data,
        'bike_usage': bike_usage_data,
        'bike_type_summary': bike_type_summary
    }
    
    # Retornar JSON para consumo pelo Power BI
    return jsonify(export_data)

@app.route('/api/profile', methods=['PUT'])
@token_required
def update_profile(current_user):
    data = request.get_json()
    
    current_user.phone = data.get('phone', current_user.phone)
    db.session.commit()
    
    return jsonify({'message': 'Profile updated successfully'})

# Initialize database and create some sample bikes
def init_db():
    with app.app_context():
        db.create_all()
        
        # Create sample bikes if none exist
        if not Bike.query.first():
            for i in range(10):
                bike = Bike(
                    name=f'Bike {i+1}',
                    type=['Mountain Bike', 'City Bike', 'Electric Bike'][i % 3],
                    latitude=-23.5505 + random.uniform(-0.01, 0.01),
                    longitude=-46.6333 + random.uniform(-0.01, 0.01),
                    available=True
                )
                db.session.add(bike)
            db.session.commit()

if __name__ == '__main__':
    init_db()
    app.run(debug=True)