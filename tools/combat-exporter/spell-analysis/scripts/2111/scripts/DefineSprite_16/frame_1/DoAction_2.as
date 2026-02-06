x = _parent.cellFrom.x;
y = _parent.cellFrom.y;
_X = x;
_Y = y;
dx = _parent.cellTo.x - x;
dy = _parent.cellTo.y - y;
d = Math.sqrt(dx * dx + dy * dy) / 2;
_rotation = Math.atan2(dy,dx) * 180 / 3.1415;
stop();
