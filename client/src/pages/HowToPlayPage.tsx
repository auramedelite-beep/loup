import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/ui';
import { RoleCard } from '@/components/RoleCard';
import { PHASE_ORDER, ROLE_IDS, TEAM_META } from '@/lib/roles';

function TeamIcon({ team, className }: { team: keyof typeof TEAM_META; className: string }) {
  const Icon = TEAM_META[team].icon;
  return <Icon size={22} className={className} strokeWidth={1.7} aria-hidden />;
}

/* ── Team icons ─────────────────────────────────────────────────────────── */
const TEAM_SECTIONS = [
  { team: 'village', labelKey: 'teams.village', color: 'text-emerald-300' },
  { team: 'werewolf', labelKey: 'teams.werewolf', color: 'text-blood-400' },
];

export function HowToPlayPage() {
  const { t } = useTranslation();

  return (
    <div className="max-w-4xl mx-auto p-6">
      <PageHeader
        eyebrow={t('common.appName')}
        title={t('howTo.title')}
        subtitle={t('howTo.subtitle')}
      />

      {/* Game flow overview */}
      <section className="mt-8 space-y-6">
        <h2 className="font-display text-xl font-bold text-parchment-100 mb-4">{t('howTo.gameFlowTitle')}</h2>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PHASE_ORDER.map((phase) => (
            <motion.div
              key={phase}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className="card p-4 border border-white/10 bg-white/05"
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="text-2xl">{t(`game.phases.${phase}`)}</span>
              </div>
              <p className="text-sm text-mist leading-relaxed">{t(`howTo.phaseDescriptions.${phase}`)}</p>
            </motion.div>
          ))}
        </div>

        {/* Teams */}
        <section className="mt-8">
          <h2 className="font-display text-xl font-bold text-parchment-100 mb-4">{t('howTo.teamsTitle')}</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {TEAM_SECTIONS.map((team) => (
              <motion.div
                key={team.team}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
                className="card p-4 border border-white/10 bg-white/05"
              >
                <div className="flex items-center gap-2 mb-2">
                  <TeamIcon team={team.team} className={team.color} />
                </div>
                <h3 className="font-display text-base font-semibold text-parchment-100">{t(team.labelKey)}</h3>
                <p className="text-sm text-mist">{t(`howTo.teamDescriptions.${team.team}`)}</p>
              </motion.div>
            ))}
          </div>
        </section>

        {/* Roles per team */}
        <section className="mt-8">
          <h2 className="font-display text-xl font-bold text-parchment-100 mb-4">{t('howTo.rolesTitle')}</h2>
          <div className="grid grid-cols-2 gap-2">
            {ROLE_IDS.map((role) => (
              <RoleCard key={role} role={role} variant="tile" />
            ))}
          </div>
        </section>
      </section>

      {/* Footer / back */}
      <div className="mt-8 text-center">
        <button className="btn-primary">{t('common.back')}</button>
      </div>
    </div>
  );
}