
// --- image handling implementation ------------------------------------------

var images = [];

/// Will clear the canvas
function clearCanvas() {
	var canvas = $('#battlemap');
	var context = canvas[0].getContext("2d");
	context.clearRect(0, 0, canvas[0].width, canvas[0].height);
}

// --- token implementation ---------------------------------------------------

var tokens       = []; // holds all tokens, updated by the server
var change_cache = []; // holds ids of all client-changed tokens

var culling = []; // holds tokens for culling
var min_z = -1; // lowest known z-order
var max_z =  1; // highest known z-order

/// Token constructor
function Token(id, url) {
	this.id = id;
	this.posx = 0;
	this.posy = 0;
	this.zorder = 0;
	this.size = 250;
	this.url = url;
	this.rotate = 0.0;
	this.locked = false;
}

/// Add token with id and url to the scene
function addToken(id, url) {
	tokens[id] = new Token(id, url);
}

/// Determines which token is selected when clicking the given position
function selectToken(x, y) {
	var result = null;
	var bestz = min_z - 1;
	// search for any fitting token with highest z-order (unlocked first)
	$.each(tokens, function(index, item) {
		if (item != null && !item.locked) {
			var min_x = item.posx - item.size / 2;
			var max_x = item.posx + item.size / 2;
			var min_y = item.posy - item.size / 2;
			var max_y = item.posy + item.size / 2;
			if (min_x <= x && x <= max_x && min_y <= y && y <= max_y) {
				if (item.zorder > bestz) {
					bestz = item.zorder;
					result = item;
				}
			}
		}
	});
	if (result == null) {
		// try locked tokens next
		$.each(tokens, function(index, item) {
			if (item != null && item.locked) {
				var min_x = item.posx - item.size / 2;
				var max_x = item.posx + item.size / 2;
				var min_y = item.posy - item.size / 2;
				var max_y = item.posy + item.size / 2;
				if (min_x <= x && x <= max_x && min_y <= y && y <= max_y) {
					if (item.zorder > bestz) {
						bestz = item.zorder;
						result = item;
					}
				}
			}
		});
	}
	return result;
}

/// Update token data for the provided token (might create a new token)
function updateToken(data) {
	// create token if necessary
	if (!tokens.includes(data.id)) {
		addToken(data.id, data.url);
	}
	
	// update token data
	tokens[data.id].posx   = data.posx;
	tokens[data.id].posy   = data.posy;
	tokens[data.id].zorder = data.zorder;
	tokens[data.id].size   = data.size;
	tokens[data.id].rotate = data.rotate;
	tokens[data.id].locked = data.locked;
	
	if (data.zorder < min_z) {
		min_z = data.zorder;
	}
	if (data.zorder > max_z) {
		max_z = data.zorder;
	}
}

/// Draws a single token (show_ui will show the selection box around it)
function drawToken(token, show_ui) {
	// cache image if necessary
	if (!images.includes(token.url)) {
		images[token.url] = new Image();
		images[token.url].src = token.url;
	}
	
	// calculate new height (keeping aspect ratio)
	var ratio = images[token.url].height / images[token.url].width;
	var w = token.size;
	var h = w * ratio;
	
	// draw image
	var canvas = $('#battlemap');
	var context = canvas[0].getContext("2d");
	context.save();
	context.translate(token.posx, token.posy);
	context.rotate(token.rotate * 3.14/180.0);
	
	if (show_ui) {
		// GM can select anything, players can select unlocked tokens
		if (as_gm || !token.locked) {
			// highlight token as selected
			context.shadowColor = 'gold';
			context.shadowBlur = 25;
		}
	}
	
	context.drawImage(images[token.url], -w / 2, -h / 2, w, h);
	
	context.restore();
}

// --- game state implementation ----------------------------------------------

var game_title = '';
var as_gm = false;
var player_color = '';
var timeid = 0;

var mouse_x = 0; // relative to canvas
var mouse_y = 0;

var copy_token = 0; // determines copy-selected token (CTRL+C)
var select_id = 0; // determines selected token
var mouse_over_id = 0; // determines which token would be selected
var grabbed = 0; // determines whether grabbed or not
var update_tick = 0; // delays updates to not every loop tick
var full_tick = 0; // counts updates until the next full update is requested

const fps = 60;

/// mouse tracking
var abs_mouse_x = 0;
var abs_mouse_y = 0;

function mouseMove(event) {
	abs_mouse_x = event.clientX;
	abs_mouse_y = event.clientY;
}


function showRoll(sides, result, player, color, time) {
	var target = $('#rollbox')[0];
	var div_class = 'roll';
	if (result == 1) {
		div_class += ' min-roll';
	}
	if (result == sides) {
		div_class += ' max-roll';
	}
	target.innerHTML += '<div class="' + div_class + '"><img src="/static/d' + sides + '.png" style="filter: drop-shadow(1px 1px 10px ' + color + ') drop-shadow(-1px -1px 0 ' + color + ');"/><span class="result" style="color: ' + color + ';">' + result + '</span><span class="player">' + player + '<br />' + time + '</span></div>';
}

function showPlayer(name, color, quit_link) {
	var out = '<span class="player" style="filter: drop-shadow(1px 1px 9px ' + color + ') drop-shadow(-1px -1px 0 ' + color + ');">';
	if (quit_link) {
		out += '<a href="/play/' + game_title + '/logout" title="Logout">';
	}
	out += name;
	if (quit_link) {
		out += '</a>';
	}
	out += '</span>';
	
	var target = $('#players')[0];
	target.innerHTML += out;
}

/// Triggers token updates (pushing and pulling token data via the server)
function updateTokens() {
	// fetch all changed tokens' data
	var changes = [];
	$.each(change_cache, function(index, token_id) {
		// copy token to update-data
		var t = tokens[token_id];
		var data = {
			'id'    : t.id,
			'posx'  : t.posx,
			'posy'  : t.posy,
			'zorder': t.zorder,
			'size'  : t.size,
			'rotate': t.rotate,
			'locked': t.locked
		};
		changes.push(data);
	});
	change_cache = [];
	
	// fake zero-timeid if full update is requested
	if (full_tick == 0) {
		timeid = 0;
		full_tick = 5;
	} else {
		full_tick -= 1;
	}
	
	// start update with server
	$.ajax({
		type: 'POST',
		url:  '/play/' + game_title + '/update',
		dataType: 'json',
		data: {
			'timeid'  : timeid,
			'changes' : JSON.stringify(changes)
		},
		success: function(response) {		
			// update current timeid
			timeid = response['timeid'];
			
			// clear all local tokens if a full update was received
			if (response['full']) {
				tokens = [];
			}
			
			// update tokens
			$.each(response['tokens'], function(index, token) {
				updateToken(token);
			});
				
			// show rolls
			var rolls_div = $('#rollbox')[0];
			rolls_div.innerHTML = '';
			$.each(response['rolls'], function(index, roll) {
				showRoll(roll['sides'], roll['result'], roll['player'], roll['color'], roll['time']);
			});
			
			// show players
			var players_div = $('#players')[0];
			var your_player_name = document.cookie.split(';')[0].split('=')[1];
			players_div.innerHTML = '';
			$.each(response['players'], function(index, line) {
				var parts = line.split(':');
				showPlayer(parts[0], parts[1], parts[0] == your_player_name);
			});
		}
	});
}

/// Draw the entire scene (locked tokens in the background, unlocked in foreground)
function drawScene() {
	clearCanvas();
	
	// add all tokens to regular array
	culling = [];
	$.each(tokens, function(index, token) {
		if (token != null) {
			culling.push(token);
		}
	});
	
	// sort tokens by z-order
	culling.sort(function(a, b) { return a.zorder - b.zorder });
	
	// draw tokens
	$.each(culling, function(index, token) {
		drawToken(token, token.id == select_id);
	});
}

/// Updates the entire game: update tokens from time to time, drawing each time
function updateGame() {
	if (update_tick < 0) {
		updateTokens();
		update_tick = 125.0 / (1000.0 / fps);
	} else {
		update_tick -= 1;
	}
	
	drawScene();
	setTimeout("updateGame()", 1000.0 / fps);
}

/// Sets up the game and triggers the update loop
function start(title, gm, color) {
	game_title = title;
	as_gm = gm;
	player_color = color;
	
	if (!gm) {
		// notify game about this player
		navigator.sendBeacon('/play/' + game_title + '/join');
	}
	
	updateGame();
}

/// Handles disconnecting
function disconnect() {
	// note: only works if another tab stays open
	navigator.sendBeacon('/play/' + game_title + '/disconnect');
}

function uploadDrag(event) {
	event.preventDefault();
	
	mouse_x = event.offsetX;
	mouse_y = event.offsetY;
}

function uploadDrop(event) {
	event.preventDefault();

	var queue = $('#uploadqueue')[0];
	queue.files = event.dataTransfer.files;
	
	var f = new FormData($('#uploadform')[0]);
	
	$.ajax({
		url: '/gm/' + game_title + '/upload/' + mouse_x + '/' + mouse_y,
		type: 'POST',
		data: f,
		contentType: false,
		cache: false,
		processData: false,
		success: function(response) {
			// reset upload queue
			$('#uploadqueue').val("");
		}
	});
}

function updateTokenbar() {
	if (mouse_over_id > 0)  {
		var token = tokens[mouse_over_id];
		var bx = $('#battlemap')[0].getBoundingClientRect();
		var x = bx.left + token.posx - token.size / 2 + 10;
		var y = bx.top + token.posy - 36;
		$('#tokenbar').css('left', x + 'px');
		$('#tokenbar').css('top', y + 'px');
		
		if (token.locked) {
			$('#tokenLock')[0].src = '/static/locked.png';
			$('#tokenTop').css('visibility', 'hidden');
			$('#tokenBottom').css('visibility', 'hidden');
			$('#tokenStretch').css('visibility', 'hidden');
		} else {	
			$('#tokenLock')[0].src = '/static/unlocked.png';
			$('#tokenTop').css('visibility', 'visible');
			$('#tokenBottom').css('visibility', 'visible');
			$('#tokenStretch').css('visibility', 'visible');
		}
	}
}

// ----------------------------------------------------------------------------

/// Select mouse/touch position relative to the canvas
function pickCanvasPos(event) {
	if (event.changedTouches) {
		var touchobj = event.changedTouches[0];
		mouse_x = touchobj.clientX;
		mouse_y = touchobj.clientY;
	} else {
		mouse_x = event.clientX;
		mouse_y = event.clientY;
	}
	
	// make pos relative
	var bx = $('#battlemap')[0].getBoundingClientRect();
	mouse_x -= bx.left;
	mouse_y -= bx.top;
}

/// Event handle for start grabbing a token
function tokenGrab(event) {
	pickCanvasPos(event);

	prev_id = select_id;
	
	select_id = 0;
	
	var token = selectToken(mouse_x, mouse_y);
	if (token != null && !token.locked) {
		select_id = token.id;
		grabbed = true;
	}
}

/// Event handle for releasing a grabbed token
function tokenRelease() {
	if (select_id != 0) {
		grabbed = false;
	}
}

/// Event handle for moving a grabbed token (if not locked)
function tokenMove(event) {
	pickCanvasPos(event);
	
	mouse_over_id = select_id;
	
	if (select_id != 0 && grabbed) {
		var token = tokens[select_id];
		if (token == null || token.locked) {
			return;
		}
		
		// update position
		token.posx = mouse_x;
		token.posy = mouse_y;
		
		// mark token as changed
		if (!change_cache.includes(select_id)) {
			change_cache.push(select_id);
		}
	}

	// handle mouse over selection	
	var token = selectToken(mouse_x, mouse_y);
	if (token != null) {
		mouse_over_id = token.id;
			
		updateTokenbar();
	}
}

/// Event handle for rotation and scaling of tokens (if not locked)
function tokenWheel(event) {
	if (select_id != 0) {
		var token = tokens[select_id];
		if (token.locked) {
			return;
		}

		if (event.shiftKey) {
			// handle scaling (GM only)
			if (as_gm) {
				token.size = token.size - 5 * event.deltaY;
				if (token.size > 1440) {
					token.size = 1440;
				}
				if (token.size < 16) {
					token.size = 16;
				}
				
				// mark token as changed
				if (!change_cache.includes(select_id)) {
					change_cache.push(select_id);
				}
			}
			
		} else {
			// handle rotation
			token.rotate = token.rotate - 5 * event.deltaY;
			if (token.rotate >= 360.0 || token.rotate <= -360.0) {
				token.rotate = 0.0;
			}
			
			// mark token as changed
			if (!change_cache.includes(select_id)) {
				change_cache.push(select_id);
			}
		}
	}
	
	updateTokenbar();
}

/// Event handle to click a dice
function rollDice(sides) {
	$.post('/play/' + game_title + '/roll/' + sides);
}

/// GM Event handle shortcuts on tokens
function tokenShortcut(event) {
	if (event.ctrlKey) {
		if (event.keyCode == 67) { // CTRL+C
			copy_token = select_id;
		} else if (event.keyCode == 86) { // CTRL+V
			if (copy_token > 0) {
				$.post('/gm/' + game_title + '/clone/' + copy_token + '/' + mouse_x + '/' + mouse_y);
				timeid = 0; // force full refresh next time
			}
		}
	} else {
		if (event.keyCode == 46) { // DEL
			if (select_id == copy_token) {
				copy_token = 0;
			}
			$.post('/gm/' + game_title + '/delete/' + select_id);
				timeid = 0; // force full refresh next time
		}
	}
}

/// GM Event handle for (un)locking a token
function tokenLock() {
	if (mouse_over_id != 0) {
		var token = tokens[mouse_over_id];
		token.locked = !token.locked;
		
		// mark token as changed
		if (!change_cache.includes(mouse_over_id)) {
			change_cache.push(mouse_over_id);
		}
		
		updateTokenbar();
	}
}

/// GM Event handle for stretching a token to fit the screen
function tokenStretch() {
	if (mouse_over_id != 0) {
		var token = tokens[mouse_over_id];
		
		if (token.locked) {
			// ignore if locked
			console.log('cannot stretch locked token');
			return;
		}
		
		// stretch and center token in the center
		var canvas = $('#battlemap')[0];
		token.posx   = canvas.width / 2;
		token.posy   = canvas.height / 2;
		token.size   = canvas.width;
		token.rotate = 0;
		token.locked = true;
			
		// mark token as changed
		if (!change_cache.includes(mouse_over_id)) {
			change_cache.push(mouse_over_id);
		}
		
		updateTokenbar();
	}
}

/// GM Event handle for moving token to lowest z-order
function tokenBottom() {
	if (mouse_over_id != 0) {
		var token = tokens[mouse_over_id];
		
		if (token.locked) {
			// ignore if locked
			console.log('cannot move locked token to bottom');
			return;
		}
		// move beneath lowest known z-order
		if (token.locked) {
			token.zorder = 1;
		} else {
			token.zorder = min_z - 1;
			--min_z;
		}
		
		// mark token as changed
		if (!change_cache.includes(mouse_over_id)) {
			change_cache.push(mouse_over_id);
		}
	}
}

/// GM Event handle for moving token to hightest z-order
function tokenTop() {
	if (mouse_over_id != 0) {
		var token = tokens[mouse_over_id];
		
		if (token.locked) {
			// ignore if locked
			console.log('cannot move locked token to top');
			return;
		}
		// move above highest known z-order
		if (token.locked) {
			token.zorder = -1;
		} else {
			token.zorder = max_z - 1;
			++max_z;
		}
			
		// mark token as changed
		if (!change_cache.includes(mouse_over_id)) {
			change_cache.push(mouse_over_id);
		}
	}
}

