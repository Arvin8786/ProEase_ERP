import React, { useState, useEffect, useMemo } from 'react';
import { 
  collection, 
  onSnapshot, 
  query, 
  where, 
  orderBy 
} from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { StockMovementRecord, UserProfile } from '../../types';
import { isExecutiveRole } from '../../lib/sapMovements';
import { 
  TrendingDown, 
  AlertTriangle, 
  Filter, 
  PieChart as PieIcon, 
  BarChart3, 
  Users, 
  Building2, 
  Tag, 
  ShieldAlert,
  ArrowDownRight,
  DollarSign,
  DownloadCloud,
  Lock
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface ShrinkageWastageAnalyticsProps {
  profile: UserProfile | null;
}

export const ShrinkageWastageAnalytics: React.FC<ShrinkageWastageAnalyticsProps> = ({ profile }) => {
  const isExecutive = isExecutiveRole(profile);
  const [movements, setMovements] = useState<StockMovementRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState<'30' | '90' | 'all'>('30');
  const [selectedDept, setSelectedDept] = useState<string>('ALL');

  useEffect(() => {
    // Listen to stockMovements with code 973 (Wastage / Scrap Write-Off)
    const q = query(
      collection(db, 'stockMovements'),
      where('movementCode', '==', '973')
    );

    const unsub = onSnapshot(q, (snapshot) => {
      const records = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      } as StockMovementRecord));
      setMovements(records);
      setLoading(false);
    }, (err) => {
      console.error('Error fetching wastage movements:', err);
      setLoading(false);
    });

    return () => unsub();
  }, []);

  // Filtered movements based on department and time
  const filteredMovements = useMemo(() => {
    return movements.filter(m => {
      if (selectedDept !== 'ALL' && m.departmentCode !== selectedDept && m.departmentName !== selectedDept) {
        return false;
      }
      return true;
    });
  }, [movements, selectedDept]);

  // Aggregate stats
  const totalWastageLoss = useMemo(() => {
    return filteredMovements.reduce((sum, m) => sum + (m.totalValue || (m.cost_price || 0) * m.quantity), 0);
  }, [filteredMovements]);

  const totalUnitsScrapped = useMemo(() => {
    return filteredMovements.reduce((sum, m) => sum + m.quantity, 0);
  }, [filteredMovements]);

  // Breakdown by Department
  const deptBreakdown = useMemo(() => {
    const map: Record<string, { name: string; loss: number; units: number; count: number }> = {};
    filteredMovements.forEach(m => {
      const dept = m.departmentName || m.departmentCode || 'Unassigned / Warehouse';
      if (!map[dept]) map[dept] = { name: dept, loss: 0, units: 0, count: 0 };
      const val = m.totalValue || (m.cost_price || 0) * m.quantity;
      map[dept].loss += val;
      map[dept].units += m.quantity;
      map[dept].count += 1;
    });
    return Object.values(map).sort((a, b) => b.loss - a.loss);
  }, [filteredMovements]);

  // Breakdown by Product / SKU
  const productBreakdown = useMemo(() => {
    const map: Record<string, { sku: string; name: string; loss: number; units: number }> = {};
    filteredMovements.forEach(m => {
      const key = m.sku || m.itemId;
      if (!map[key]) map[key] = { sku: m.sku, name: m.materialName, loss: 0, units: 0 };
      const val = m.totalValue || (m.cost_price || 0) * m.quantity;
      map[key].loss += val;
      map[key].units += m.quantity;
    });
    return Object.values(map).sort((a, b) => b.loss - a.loss).slice(0, 8);
  }, [filteredMovements]);

  // Breakdown by Staff Handler
  const staffBreakdown = useMemo(() => {
    const map: Record<string, { name: string; loss: number; units: number; incidentCount: number }> = {};
    filteredMovements.forEach(m => {
      const staff = m.executedBy || 'System / Unlogged';
      if (!map[staff]) map[staff] = { name: staff, loss: 0, units: 0, incidentCount: 0 };
      const val = m.totalValue || (m.cost_price || 0) * m.quantity;
      map[staff].loss += val;
      map[staff].units += m.quantity;
      map[staff].incidentCount += 1;
    });
    return Object.values(map).sort((a, b) => b.loss - a.loss);
  }, [filteredMovements]);

  return (
    <div className="space-y-6">
      {/* Header and Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 bg-rose-100 text-rose-700 rounded-xl">
              <ShieldAlert className="w-5 h-5" />
            </span>
            <div>
              <h2 className="text-xl font-bold text-slate-900">SAP 973 Shrinkage & Wastage Analytics</h2>
              <p className="text-xs text-slate-500">
                Audited tracking of stock write-offs, damaged items, breakage, and operational losses.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <Select value={selectedDept} onValueChange={setSelectedDept}>
            <SelectTrigger className="w-[180px] h-9 text-xs bg-slate-50">
              <SelectValue placeholder="All Departments" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Cost Centers</SelectItem>
              {deptBreakdown.map(d => (
                <SelectItem key={d.name} value={d.name}>{d.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="border-rose-200/80 bg-rose-50/40 shadow-xs">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs font-semibold text-rose-600 flex items-center justify-between">
              Total Financial Shrinkage
              {isExecutive ? <DollarSign className="w-4 h-4 text-rose-500" /> : <Lock className="w-4 h-4 text-rose-400" />}
            </CardDescription>
            <CardTitle className="text-2xl font-bold text-rose-900 font-mono">
              {isExecutive 
                ? `$${totalWastageLoss.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` 
                : '•••• (Executive)'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-[11px] text-rose-700">
              {isExecutive 
                ? 'Cumulative financial impact from manual 973 write-offs.' 
                : 'Financial loss valuations masked for standard personnel.'}
            </p>
          </CardContent>
        </Card>

        <Card className="border-slate-200/80 bg-white shadow-xs">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs font-semibold text-slate-600 flex items-center justify-between">
              Scrapped Physical Units
              <TrendingDown className="w-4 h-4 text-amber-500" />
            </CardDescription>
            <CardTitle className="text-2xl font-bold text-slate-900 font-mono">
              {totalUnitsScrapped.toLocaleString()} <span className="text-xs font-normal text-slate-500">Units</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-[11px] text-slate-500">
              Total quantity removed across {filteredMovements.length} logged incidents.
            </p>
          </CardContent>
        </Card>

        <Card className="border-slate-200/80 bg-white shadow-xs">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs font-semibold text-slate-600 flex items-center justify-between">
              Highest Loss Department
              <Building2 className="w-4 h-4 text-blue-500" />
            </CardDescription>
            <CardTitle className="text-xl font-bold text-slate-900 truncate">
              {deptBreakdown[0]?.name || 'None'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-[11px] text-slate-500 font-mono">
              {isExecutive 
                ? `$${(deptBreakdown[0]?.loss || 0).toFixed(2)} (${((deptBreakdown[0]?.loss || 0) / (totalWastageLoss || 1) * 100).toFixed(1)}% of total)`
                : `${deptBreakdown[0]?.units || 0} Units Scrapped`}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Breakdown Grid: Department & Top Materials */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Department Losses */}
        <Card className="border-slate-200/80 bg-white shadow-xs">
          <CardHeader className="pb-3 border-b border-slate-100">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-2 text-slate-900">
                <Building2 className="w-4 h-4 text-blue-600" /> Wastage by Cost Center / Department
              </CardTitle>
              <Badge variant="outline" className="text-[10px]">973 Ledger</Badge>
            </div>
          </CardHeader>
          <CardContent className="pt-4 space-y-4">
            {deptBreakdown.length === 0 ? (
              <div className="text-center py-8 text-xs text-slate-400">
                No wastage movements logged yet.
              </div>
            ) : (
              deptBreakdown.map((dept) => {
                const percentage = totalWastageLoss > 0 ? (dept.loss / totalWastageLoss) * 100 : 0;
                return (
                  <div key={dept.name} className="space-y-1.5">
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-semibold text-slate-800">{dept.name}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-slate-500 text-[11px]">{dept.units} pcs ({dept.count} events)</span>
                        <span className="font-bold text-rose-600 font-mono">
                          {isExecutive ? `$${dept.loss.toFixed(2)}` : '••••'}
                        </span>
                      </div>
                    </div>
                    <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                      <div 
                        className="bg-rose-500 h-full rounded-full transition-all duration-300"
                        style={{ width: `${Math.min(100, Math.max(5, percentage))}%` }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        {/* Staff Handler Breakdown */}
        <Card className="border-slate-200/80 bg-white shadow-xs">
          <CardHeader className="pb-3 border-b border-slate-100">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-2 text-slate-900">
                <Users className="w-4 h-4 text-purple-600" /> Wastage by Staff Handler
              </CardTitle>
              <Badge variant="outline" className="text-[10px]">Accountability Matrix</Badge>
            </div>
          </CardHeader>
          <CardContent className="pt-4 space-y-4">
            {staffBreakdown.length === 0 ? (
              <div className="text-center py-8 text-xs text-slate-400">
                No staff handler incidents logged.
              </div>
            ) : (
              staffBreakdown.map((staff) => {
                const percentage = totalWastageLoss > 0 ? (staff.loss / totalWastageLoss) * 100 : 0;
                return (
                  <div key={staff.name} className="space-y-1.5">
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-semibold text-slate-800">{staff.name}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-slate-500 text-[11px]">{staff.incidentCount} writes-off</span>
                        <span className="font-bold text-amber-600 font-mono">
                          {isExecutive ? `$${staff.loss.toFixed(2)}` : '••••'}
                        </span>
                      </div>
                    </div>
                    <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                      <div 
                        className="bg-amber-500 h-full rounded-full transition-all duration-300"
                        style={{ width: `${Math.min(100, Math.max(5, percentage))}%` }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>

      {/* Detailed Stock Write-Off Audit Trail */}
      <Card className="border-slate-200/80 bg-white shadow-xs">
        <CardHeader className="p-4 border-b border-slate-100 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-sm font-semibold text-slate-900">
              Itemized 973 Write-Off Audit Log
            </CardTitle>
            <CardDescription className="text-xs">
              Sequential 45000XXXXX documents with mandatory justification reason and batch tracking.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-slate-50">
                <TableRow>
                  <TableHead className="text-xs font-semibold">Doc Number (45000XXXXX)</TableHead>
                  <TableHead className="text-xs font-semibold">SKU / Item</TableHead>
                  <TableHead className="text-right text-xs font-semibold">Scrapped Qty</TableHead>
                  <TableHead className="text-right text-xs font-semibold">Loss Value</TableHead>
                  <TableHead className="text-xs font-semibold">Cost Center</TableHead>
                  <TableHead className="text-xs font-semibold">Staff Handler</TableHead>
                  <TableHead className="text-xs font-semibold">Audit Justification Reason</TableHead>
                  <TableHead className="text-xs font-semibold">Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredMovements.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-xs text-slate-400">
                      No stock wastage write-offs recorded in this period.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredMovements.map((m) => {
                    const lossVal = m.totalValue || (m.cost_price || 0) * m.quantity;
                    const dateStr = m.timestamp?.toDate ? m.timestamp.toDate().toLocaleDateString() : 'Recent';
                    return (
                      <TableRow key={m.id} className="hover:bg-slate-50/70">
                        <TableCell className="font-mono text-xs font-bold text-slate-900">
                          {m.documentNumber}
                        </TableCell>
                        <TableCell>
                          <div className="font-medium text-xs text-slate-900">{m.materialName}</div>
                          <div className="font-mono text-[10px] text-slate-500">{m.sku}</div>
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs text-rose-600 font-semibold">
                          -{m.quantity} {m.unit}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs font-bold text-rose-600">
                          {isExecutive ? `$${lossVal.toFixed(2)}` : '••••'}
                        </TableCell>
                        <TableCell className="text-xs text-slate-700">
                          {m.departmentName || m.departmentCode || 'Warehouse'}
                        </TableCell>
                        <TableCell className="text-xs text-slate-700">
                          {m.executedBy}
                        </TableCell>
                        <TableCell className="text-xs text-slate-600 max-w-xs truncate">
                          <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200 mr-1.5">
                            Reason
                          </Badge>
                          {m.reason || 'Manual Scrap'}
                        </TableCell>
                        <TableCell className="text-xs text-slate-500">
                          {dateStr}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
