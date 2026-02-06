_X = _parent.cellFrom.x;
_Y = _parent.cellFrom.y;
c = 1;
while(c < 20)
{
   this.attachMovie("goutte","goutte" + c,c);
   c++;
}
