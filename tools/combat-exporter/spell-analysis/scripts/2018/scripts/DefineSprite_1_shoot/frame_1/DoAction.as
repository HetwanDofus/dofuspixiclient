_rotation = 0;
xi = this._x;
yi = this._y;
c = 0;
var p = 0;
while(p < 7)
{
   this._parent.attachMovie("fumee2","fumee2" + c + 200,c + 200);
   var f = this._parent["fumee2" + c + 200];
   f._x = this._x;
   f._y = this._y;
   f.vx = this._x - xi + 5 * (Math.random() - 0.5);
   f.vy = -5 * Math.random();
   c++;
   xi = this._x;
   yi = this._y;
   p++;
}
